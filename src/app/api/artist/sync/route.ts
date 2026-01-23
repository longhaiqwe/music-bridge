import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';
import { processSongSync } from '@/lib/sync-service';



export async function POST(request: Request) {
    const body = await request.json();
    const { artistId, count = 10, artistName, songs, createPlaylist = true } = body;

    const encoder = new TextEncoder();

    // Create a streaming response
    const stream = new ReadableStream({
        async start(controller) {
            const log = (msg: string, data?: any) => {
                // Output to terminal for debugging
                console.log(msg);
                // Output to stream for frontend
                const text = JSON.stringify({ type: 'log', message: msg, data }) + '\n';
                controller.enqueue(encoder.encode(text));
            };

            try {
                const cookie = request.headers.get('x-netease-cookie') || undefined;
                log(`Starting sync for ${artistName}...`);

                // 1. Get Songs
                let targetSongs = [];
                if (songs && Array.isArray(songs) && songs.length > 0) {
                    log(`Using ${songs.length} selected songs.`);
                    targetSongs = songs;
                } else {
                    log('Fetching top songs from Netease...');
                    const topSongs = await neteaseService.getArtistTopSongs(artistId, cookie);
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

                        // Map Netease/QQ song structure to MusicInfo
                        // Netease uses 'ar'/'al', structure is slightly different but manageble.
                        // But wait, getArtistTopSongs returns Netease format. 
                        // We need to construct a base MusicInfo to pass to service.

                        const artistsList = song.ar || song.artists || [];
                        const albumObj = song.al || song.album || {};
                        const artistStr = artistsList.map((a: any) => a.name).join(', ') || artistName;

                        const baseInfo = {
                            id: String(song.id),
                            name: song.name,
                            artist: artistStr,
                            album: albumObj.name,
                            duration: song.dt ? song.dt / 1000 : 0,
                            coverUrl: albumObj.picUrl,
                            source: 'netease',
                            originalId: String(song.id)
                        };

                        const uploadRes = await processSongSync(baseInfo, {
                            onLog: (msg) => log(msg),
                            neteaseCookie: cookie
                        });

                        // Logic for ID extraction (unchanged from service return)
                        let finalCloudId = uploadRes.songId;

                        if (finalCloudId) {
                            cloudIds.push(finalCloudId);
                            results.success++;
                        } else {
                            if (uploadRes.skipped) {
                                // Testing mode
                            } else {
                                log(`Upload successful but no ID returned.`);
                                results.failed++;
                                results.failedSongs.push(`${song.name} (Upload ID missing)`);
                            }
                        }

                    } catch (err: any) {
                        log(`Error processing ${song.name}: ${err.message}`);
                        results.failed++;
                        results.failedSongs.push(`${song.name} (${err.message})`);
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
                        const playlist = await neteaseService.createPlaylist(artistName, cookie);

                        if (playlist && playlist.id) {
                            log(`Adding ${cloudIds.length} songs to playlist(ID: ${playlist.id})...`);
                            // Reverse the order so that the first searched song appears first in the playlist
                            // (Counteracting the 'newest first' or stack behavior effectively)
                            // Also deduplicate to prevent API errors
                            const uniqueCloudIds = Array.from(new Set(cloudIds));
                            const reversedCloudIds = [...uniqueCloudIds].reverse();

                            log(`Adding ${reversedCloudIds.length} unique songs to playlist(ID: ${playlist.id})...`);
                            const added = await neteaseService.addSongsToPlaylist(playlist.id, reversedCloudIds, cookie);
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
