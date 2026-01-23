import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';
import { downloadManager } from '@/lib/downloader';
import { qqMusicService } from '@/lib/qqmusic';
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
    const { artistId, count = 10, artistName, songs, createPlaylist = true } = body;

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
                const results = {
                    success: 0,
                    failed: 0,
                    failedSongs: [] as string[]
                };

                for (let i = 0; i < targetSongs.length; i++) {
                    const song = targetSongs[i];
                    const query = `${song.name} ${artistName}`;
                    let rawPath = '';
                    let tmpPath = '';

                    try {
                        log(`[${i + 1}/${targetSongs.length}] Processing: ${song.name}`);

                        // STRATEGY: Prioritize Lyric Length (Duration) from QQ Music
                        // 1. Fetch Lyrics/Info first to get authoritative Duration
                        let downloadInfo = null;
                        let lyrics = ''; // Store lyrics here

                        try {
                            log(`[Strategy] Pre-fetching lyrics/info from QQ Music...`);
                            const qqSongs = await qqMusicService.search(query);

                            // Find the best match that HAS lyrics and is preferably NOT live
                            // Helper to check live
                            const isLive = (name: string) => /live|concert|现场|演唱会/i.test(name);
                            let robustCandidate = null;

                            for (const qs of qqSongs) {
                                // Skip if live (unless we have no other choice, handled by robustCandidate)
                                if (isLive(qs.name)) {
                                    if (!robustCandidate) robustCandidate = qs;
                                    continue;
                                }

                                // Check Lyrics
                                const lrc = await qqMusicService.getLyric(qs.id);
                                if (lrc && lrc.length > 200) {
                                    lyrics = lrc;
                                    // Map to MusicInfo
                                    downloadInfo = {
                                        id: String(qs.id),
                                        name: qs.name,
                                        artist: qs.ar.map((a: any) => a.name).join('/'),
                                        album: qs.al.name,
                                        duration: qs.dt / 1000,
                                        coverUrl: qs.al.picUrl,
                                        source: 'qq',
                                        originalId: String(qs.id)
                                    };
                                    log(`[Strategy] Locked target via lyrics: ${qs.name} (${downloadInfo.duration}s)`);
                                    break;
                                }
                            }

                            // If no perfect match, use robust candidate if it has lyrics
                            if (!downloadInfo && robustCandidate) {
                                const qs = robustCandidate as any;
                                const lrc = await qqMusicService.getLyric(qs.id);
                                if (lrc && lrc.length > 200) {
                                    lyrics = lrc;
                                    downloadInfo = {
                                        id: String(qs.id),
                                        name: qs.name,
                                        artist: qs.ar.map((a: any) => a.name).join('/'),
                                        album: qs.al.name,
                                        duration: qs.dt / 1000,
                                        coverUrl: qs.al.picUrl,
                                        source: 'qq',
                                        originalId: String(qs.id)
                                    };
                                    log(`[Strategy] Using fallback target via lyrics: ${qs.name} (${downloadInfo.duration}s)`);
                                }
                            }

                        } catch (e: any) {
                            console.warn(`[Strategy] QQ Pre-fetch failed: ${e.message}`);
                        }

                        // 2. Fallback: If no lyrics-validated match, use standard search
                        if (!downloadInfo) {
                            log(`[Strategy] No lyrics-guided match. Using standard search.`);
                            const searchResults = await downloadManager.search(query);
                            if (searchResults && searchResults.length > 0) {
                                // Filter live if possible
                                const nonLiveMatches = searchResults.filter(res => !/live|concert|现场|演唱会/i.test(res.name));
                                downloadInfo = nonLiveMatches.length > 0 ? nonLiveMatches[0] : searchResults[0];
                                log(`[Strategy] Standard search picked: ${downloadInfo.name}`);
                            }
                        }

                        if (!downloadInfo) {
                            log(`No results found for ${song.name}`);
                            results.failed++;
                            results.failedSongs.push(`${song.name} (No results)`);
                            continue;
                        }

                        // 3. Download (This triggers YouTube search with the duration from downloadInfo)
                        const downloadUrl = await downloadManager.getDownloadUrl(downloadInfo);
                        if (!downloadUrl) {
                            log(`Could not get download URL for ${song.name}`);
                            results.failed++;
                            results.failedSongs.push(`${song.name} (Download URL failed)`);
                            continue;
                        }

                        // Download to temp
                        // Determine file extension from downloaded path
                        let ext = path.extname(downloadUrl).replace('.', '') || 'webm';

                        // If downloadUrl is a local file path (which it should be for YouTube source now)
                        if (fs.existsSync(downloadUrl)) {
                            // It's a local file
                            log(`Source returned local file: ${downloadUrl}`);
                            ext = path.extname(downloadUrl).replace('.', '') || 'mp3';
                        }

                        const safeFileName = getSafeFileName(song.name, 'mp3');
                        rawPath = path.join(TMP_DIR, `raw_${Date.now()}.${ext}`);
                        tmpPath = path.join(TMP_DIR, safeFileName);

                        if (fs.existsSync(downloadUrl)) {
                            // Copy local file to rawPath
                            fs.copyFileSync(downloadUrl, rawPath);
                        } else {
                            // It's a remote URL, download it
                            await downloadFile(downloadUrl, rawPath);
                        }

                        // Embed proper metadata so NetEase Cloud can display correctly
                        log(`Embedding metadata for ${song.name}...`);

                        // Fix: Handle different property names (Netease vs QQ vs Standard)
                        // Netease/QQ often use 'ar' for artists and 'al' for album
                        const artistsList = song.ar || song.artists || [];
                        const albumObj = song.al || song.album || {};

                        const songArtists = artistsList.map((a: any) => a.name).join(', ') || artistName;
                        const albumName = albumObj.name || '';
                        const coverUrl = albumObj.picUrl;

                        // Fetch Lyrics (Fallback only if Step 1 failed)
                        const MIN_LYRICS_LENGTH = 200;

                        if (!lyrics) {
                            try {
                                log(`[Lyrics] Trying NetEase fallback...`);
                                const searchRes = await neteaseService.searchSong(`${song.name} ${artistName}`);
                                if (searchRes && searchRes.length > 0) {
                                    const bestMatch = searchRes[0];
                                    const neLyrics = await neteaseService.getLyric(bestMatch.id);

                                    if (neLyrics && neLyrics.length >= MIN_LYRICS_LENGTH) {
                                        log(`[Lyrics] Found lyrics on NetEase (${neLyrics.length} chars)`);
                                        lyrics = neLyrics;
                                    } else {
                                        // Try "Original" keywords on NetEase
                                        console.log(`[Lyrics] NetEase lyrics short, retrying keywords...`);
                                        const retryQueries = [`${song.name} ${artistName} 原版`, `${song.name} ${artistName} 官方`];
                                        for (const q of retryQueries) {
                                            const retryRes = await neteaseService.searchSong(q);
                                            if (retryRes?.[0]) {
                                                const retryLrc = await neteaseService.getLyric(retryRes[0].id);
                                                if (retryLrc && retryLrc.length > (neLyrics?.length || 0)) {
                                                    lyrics = retryLrc;
                                                    log(`[Lyrics] Found better lyrics on NetEase retry (${lyrics.length} chars)`);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (e: any) {
                                console.warn(`[Lyrics] Error fetching lyrics:`, e.message);
                            }
                        }



                        await embedMetadata(rawPath, tmpPath, {
                            title: song.name,
                            artist: songArtists,
                            album: albumName,
                            coverUrl: coverUrl,
                            lyrics: lyrics
                        });

                        // Upload to Cloud
                        log(`Uploading ${song.name} to Netease Cloud Disk...`);
                        const uploadRes = await neteaseService.uploadToCloudDisk(tmpPath);



                        // PRIORITIZE privateCloud.songId over songId
                        // songId is often the "matched" public ID (which might be grey/unavailable)
                        // privateCloud.songId is the ID of the file we just uploaded
                        let finalCloudId = null;

                        if (uploadRes?.privateCloud?.songId) {
                            finalCloudId = uploadRes.privateCloud.songId;
                            log(`Uploaded success! Using Private Cloud ID: ${finalCloudId}`);
                        } else if (uploadRes?.songId) {
                            finalCloudId = uploadRes.songId;
                            log(`Uploaded success! Using Public Match ID: ${finalCloudId} (Warning: might be matched to public song)`);
                        } else if (uploadRes?.id) {
                            finalCloudId = uploadRes.id;
                            log(`Uploaded success! Using General ID: ${finalCloudId}`);
                        } else if (uploadRes?.result?.songId) {
                            finalCloudId = uploadRes.result.songId;
                            log(`Uploaded success! Using Result ID: ${finalCloudId}`);
                        } else if (uploadRes?.data?.songId) {
                            finalCloudId = uploadRes.data.songId;
                            log(`Uploaded success! Using Data ID: ${finalCloudId}`);
                        }

                        if (finalCloudId) {
                            cloudIds.push(finalCloudId);
                            results.success++;
                        } else {
                            log(`Upload response ambiguous (check logs). Response keys: ${Object.keys(uploadRes || {}).join(', ')}`, uploadRes);
                            // Even if we can't find an ID, if the upload didn't throw, it "succeeded" in uploading but failed to get ID.
                            // We treat it as failed for playlist purposes.
                            results.failed++;
                            results.failedSongs.push(`${song.name} (Upload ID missing)`);
                        }

                    } catch (err: any) {
                        log(`Error processing ${song.name}: ${err.message}`);
                        results.failed++;
                        results.failedSongs.push(`${song.name} (${err.message})`);
                    } finally {
                        // Clean up temp files strictly
                        if (rawPath && fs.existsSync(rawPath)) {
                            try { fs.unlinkSync(rawPath); } catch { }
                        }
                        if (tmpPath && fs.existsSync(tmpPath)) {
                            try { fs.unlinkSync(tmpPath); } catch { }
                        }
                    }
                }

                // Log Final Summary
                log('----------------------------------------');
                log(`Sync Summary: Success: ${results.success}, Failed: ${results.failed}`);
                if (results.failed > 0) {
                    log('Failed Songs:');
                    results.failedSongs.forEach(s => log(` - ${s}`));
                }
                log('----------------------------------------');

                // Send structured summary event for frontend UI
                const summaryEvent = JSON.stringify({
                    type: 'summary',
                    stats: {
                        success: results.success,
                        failed: results.failed,
                        failedSongs: results.failedSongs
                    }
                }) + '\n';
                controller.enqueue(encoder.encode(summaryEvent));

                // 3. Create Playlist
                if (createPlaylist && cloudIds.length > 0) {
                    try {
                        log(`Creating playlist: ${artistName}...`);
                        const playlist = await neteaseService.createPlaylist(artistName);

                        if (playlist && playlist.id) {
                            log(`Adding ${cloudIds.length} songs to playlist(ID: ${playlist.id})...`);
                            // Reverse the order so that the first searched song appears first in the playlist
                            // (Counteracting the 'newest first' or stack behavior effectively)
                            // Also deduplicate to prevent API errors
                            const uniqueCloudIds = Array.from(new Set(cloudIds));
                            const reversedCloudIds = [...uniqueCloudIds].reverse();

                            log(`Adding ${reversedCloudIds.length} unique songs to playlist(ID: ${playlist.id})...`);
                            const added = await neteaseService.addSongsToPlaylist(playlist.id, reversedCloudIds);
                            if (added) {
                                log('Playlist updated successfully!');
                            } else {
                                log('Warning: Failed to add some songs to the playlist.');
                            }
                        } else {
                            log('Failed to create playlist (No ID returned).');
                        }
                    } catch (playlistError: any) {
                        const errMsg = playlistError?.body?.message || playlistError.message || JSON.stringify(playlistError);
                        log(`Warning: Playlist creation failed: ${errMsg}`);
                        if (playlistError?.status === 405) {
                            log('Tip: NetEase API returned "Too Frequent". Try manually creating a playlist later.');
                        }
                    }
                } else if (!createPlaylist && cloudIds.length > 0) {
                    log('Skipping playlist creation as requested.');
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
