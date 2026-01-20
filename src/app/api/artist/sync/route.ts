import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';
import { downloadManager } from '@/lib/downloader';
import { embedMetadata, getSafeFileName } from '@/lib/metadata';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

// Helper to download file
async function downloadFile(url: string, dest: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download: ${res.statusText}`);
    if (!res.body) throw new Error('No body');
    // @ts-ignore
    await pipeline(res.body, createWriteStream(dest));
}

const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

export async function POST(request: Request) {
    const body = await request.json();
    const { artistId, count = 10, artistName, songs } = body;

    const encoder = new TextEncoder();

    // Create a streaming response
    const stream = new ReadableStream({
        async start(controller) {
            const log = (msg: string, data?: any) => {
                const text = JSON.stringify({ type: 'log', message: msg, data }) + '\n';
                controller.enqueue(encoder.encode(text));
            };

            try {
                log(`Starting sync for ${artistName}...`);

                // 1. Get Songs
                let targetSongs = [];
                if (songs && Array.isArray(songs) && songs.length > 0) {
                    log(`Using ${songs.length} selected songs.`);
                    targetSongs = songs;
                } else {
                    log('Fetching top songs from Netease...');
                    const topSongs = await neteaseService.getArtistTopSongs(artistId);
                    targetSongs = topSongs.slice(0, count);
                    log(`Found ${topSongs.length} songs, syncing top ${targetSongs.length}`);
                }

                const cloudIds: any[] = [];

                // 2. Loop through songs
                for (let i = 0; i < targetSongs.length; i++) {
                    const song = targetSongs[i];
                    const query = `${song.name} ${artistName}`;

                    try {
                        log(`[${i + 1}/${targetSongs.length}] Processing: ${song.name}`);

                        // Search source
                        const searchResults = await downloadManager.search(query);
                        if (!searchResults || searchResults.length === 0) {
                            log(`No results found for ${song.name}`);
                            continue;
                        }

                        // Pick best match (simple: first one)
                        const bestMatch = searchResults[0];

                        // Get download URL
                        const downloadUrl = await downloadManager.getDownloadUrl(bestMatch);
                        if (!downloadUrl) {
                            log(`Could not get download URL for ${song.name}`);
                            continue;
                        }

                        // Download to temp
                        // Download to temp
                        // Determine file extension from downloaded path
                        let ext = path.extname(downloadUrl).replace('.', '') || 'webm';

                        // If downloadUrl is a local file path (which it should be for YouTube source now)
                        if (fs.existsSync(downloadUrl)) {
                            // It's a local file
                            log(`Source returned local file: ${downloadUrl}`);
                            ext = path.extname(downloadUrl).replace('.', '') || 'mp3';
                        }

                        const safeFileName = getSafeFileName(song.name, ext);
                        const rawPath = path.join(TMP_DIR, `raw_${Date.now()}.${ext}`);
                        const tmpPath = path.join(TMP_DIR, safeFileName);

                        if (fs.existsSync(downloadUrl)) {
                            // Copy local file to rawPath
                            fs.copyFileSync(downloadUrl, rawPath);
                        } else {
                            // It's a remote URL, download it
                            await downloadFile(downloadUrl, rawPath);
                        }

                        // Embed proper metadata so NetEase Cloud can display correctly
                        log(`Embedding metadata for ${song.name}...`);
                        const songArtists = song.artists?.map((a: any) => a.name).join(', ') || artistName;
                        await embedMetadata(rawPath, tmpPath, {
                            title: song.name,
                            artist: songArtists,
                            album: song.album?.name || '',
                            coverUrl: song.album?.picUrl
                        });

                        // Clean up raw file
                        try { fs.unlinkSync(rawPath); } catch { }

                        // Upload to Cloud
                        log(`Uploading ${song.name}...`);
                        const uploadRes = await neteaseService.uploadToCloudDisk(tmpPath);

                        // Clean up temp file
                        try { fs.unlinkSync(tmpPath); } catch { }

                        if (uploadRes?.songId) {
                            cloudIds.push(uploadRes.songId);
                            log(`Uploaded success! Cloud ID: ${uploadRes.songId}`);
                        } else if (uploadRes?.privateCloud?.songId) {
                            // Structure might vary
                            cloudIds.push(uploadRes.privateCloud.songId);
                            log(`Uploaded success! Cloud ID: ${uploadRes.privateCloud.songId}`);
                        } else {
                            // Try to inspect response for song ID
                            // Sometimes it's in a different field
                            log(`Upload response might be incomplete (check logs).`, uploadRes);
                            // If we can't find ID, we can't add to playlist.
                            // But let's hope it's standard structure
                        }

                    } catch (err: any) {
                        log(`Error processing ${song.name}: ${err.message}`);
                    }
                }

                // 3. Create Playlist
                if (cloudIds.length > 0) {
                    log(`Creating playlist: ${artistName} Top Songs...`);
                    const playlist = await neteaseService.createPlaylist(`${artistName} Top ${cloudIds.length}`);

                    if (playlist && playlist.id) {
                        log(`Adding ${cloudIds.length} songs to playlist...`);
                        await neteaseService.addSongsToPlaylist(playlist.id, cloudIds);
                        log('Playlist updated successfully!');
                    } else {
                        log('Failed to create playlist.');
                    }
                } else {
                    log('No songs uploaded, skipping playlist creation.');
                }

                log('Sync completed!');
                controller.close();

            } catch (error: any) {
                log(`Critical Error: ${error.message}`);
                controller.close();
            }
        }
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked'
        },
    });
}
