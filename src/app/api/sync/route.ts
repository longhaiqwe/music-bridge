import { NextResponse } from 'next/server';
import { downloadManager } from '@/lib/downloader';
import { neteaseService } from '@/lib/netease';
import { qqMusicService } from '@/lib/qqmusic';
import { embedMetadata, getSafeFileName } from '@/lib/metadata';
import fs from 'fs';
import path from 'path';
import { MusicInfo } from '@/lib/downloader/types';

const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');

export async function POST(request: Request) {
    let step = 'init';
    try {
        const info: MusicInfo = await request.json();

        if (!info || !info.id || !info.source) {
            return NextResponse.json({ error: 'Invalid music info' }, { status: 400 });
        }

        // 1. Pre-fetch Strategy (QQ Music First)
        console.log(`[Strategy] Pre-fetching lyrics/info from QQ Music for: ${info.name} - ${info.artist}`);

        let lyrics = '';
        let downloadInfo: MusicInfo = { ...info }; // Start with original info

        try {
            const query = `${info.name} ${info.artist}`;
            const qqSongs = await qqMusicService.search(query);

            // Find best match (Strategy: Lyrics Length > 200, Prefer Non-Live)
            const isLive = (name: string) => /live|concert|现场|演唱会/i.test(name);
            let robustCandidate = null;
            let finalMatch = null;

            for (const qs of qqSongs) {
                // Skip if live (unless we have no other choice)
                if (isLive(qs.name)) {
                    if (!robustCandidate) robustCandidate = qs;
                    continue;
                }

                // Check Lyrics
                const lrc = await qqMusicService.getLyric(qs.id);
                if (lrc && lrc.length > 200) {
                    lyrics = lrc;
                    finalMatch = qs;
                    console.log(`[Strategy] Locked target via lyrics: ${qs.name}`);
                    break;
                }
            }

            // Fallback to robust candidate if no perfect match
            if (!finalMatch && robustCandidate) {
                const qs = robustCandidate as any;
                const lrc = await qqMusicService.getLyric(qs.id);
                if (lrc && lrc.length > 200) {
                    lyrics = lrc;
                    finalMatch = qs;
                    console.log(`[Strategy] Using fallback target via lyrics: ${qs.name}`);
                }
            }

            if (finalMatch) {
                const qs = finalMatch;
                // Update download info with authoritative data
                downloadInfo = {
                    ...downloadInfo,
                    duration: qs.dt / 1000,
                    album: qs.al.name,
                    artist: qs.ar.map((a: any) => a.name).join('/'), // Update artist in case of typos
                    songName: qs.name // Explicit song name for penalties
                };
                console.log(`[Strategy] Updated info with QQ Music data: Duration=${downloadInfo.duration}s`);
            } else {
                console.log(`[Strategy] No suitable QQ Music match found (lyrics missing or short). Using original info.`);
            }

        } catch (e) {
            console.warn(`[Strategy] QQ Pre-fetch failed, proceeding with original info:`, e);
        }

        // 2. Download
        step = 'download';
        console.log(`Starting download for: ${downloadInfo.name} (Duration: ${downloadInfo.duration}s)`);

        // Pass the updated downloadInfo which might contain the authoritative duration/name
        const rawFilePath = await downloadManager.getDownloadUrl(downloadInfo);
        console.log(`Downloaded to: ${rawFilePath}`);

        // 2. Embed metadata
        step = 'metadata';
        console.log('Embedding metadata...');

        // Fetch Lyrics (Fallback to NetEase if QQ Music failed)
        const MIN_LYRICS_LENGTH = 200; // Minimum chars to consider lyrics valid

        if (!lyrics) {
            try {
                console.log(`[Lyrics] QQ Music lyrics missing, searching NetEase for: ${info.name} ${info.artist}`);
                const query = `${info.name} ${info.artist}`;
                const searchRes = await neteaseService.searchSong(query);

                if (searchRes && searchRes.length > 0) {
                    // Determine best match? For now just pick first
                    const bestMatch = searchRes[0];
                    console.log(`[Lyrics] Found match: ${bestMatch.name} (ID: ${bestMatch.id})`);

                    lyrics = await neteaseService.getLyric(bestMatch.id);

                    // Retry if lyrics too short (likely instrumental/wrong version)
                    if (lyrics && lyrics.length < MIN_LYRICS_LENGTH) {
                        console.log(`[Lyrics] ⚠️ Lyrics too short (${lyrics.length} chars < ${MIN_LYRICS_LENGTH}), retrying...`);

                        // Try with "原版" keyword to find original version
                        const retryQueries = [
                            `${info.name} ${info.artist} 原版`,
                            `${info.name} ${info.artist} 官方`,
                            `${info.name} ${info.artist} 正版`
                        ];

                        for (const retryQuery of retryQueries) {
                            const retryRes = await neteaseService.searchSong(retryQuery);
                            if (retryRes && retryRes.length > 0) {
                                const retryMatch = retryRes[0];
                                const retryLyrics = await neteaseService.getLyric(retryMatch.id);

                                if (retryLyrics && retryLyrics.length > lyrics.length) {
                                    console.log(`[Lyrics] Found better lyrics with query "${retryQuery}" (${retryLyrics.length} chars)`);
                                    lyrics = retryLyrics;
                                    break;
                                }
                            }
                        }
                    }

                    if (lyrics) {
                        if (lyrics.length < MIN_LYRICS_LENGTH) {
                            console.log(`[Lyrics] ⚠️ Lyrics still short (${lyrics.length} chars)`);
                        } else {
                            console.log(`[Lyrics] Successfully fetched lyrics (${lyrics.length} chars)`);
                        }
                    } else {
                        console.log('[Lyrics] Lyrics empty');
                    }
                } else {
                    console.log('[Lyrics] No match found on NetEase');
                }
            } catch (e) {
                console.warn('[Lyrics] Failed to fetch lyrics from NetEase', e);
            }
        } else {
            console.log(`[Lyrics] Using pre-fetched lyrics from QQ Music (${lyrics.length} chars)`);
        }

        const ext = path.extname(rawFilePath).replace('.', '');
        const finalFileName = getSafeFileName(info.name, ext);
        const finalFilePath = path.join(TMP_DIR, finalFileName);

        await embedMetadata(rawFilePath, finalFilePath, {
            title: info.name,
            artist: info.artist,
            album: info.album || '',
            coverUrl: info.coverUrl,
            lyrics: lyrics // Embed lyrics
        });

        // Clean up raw file logic removed to preserve cache
        // if (rawFilePath !== finalFilePath) {
        //    try { fs.unlinkSync(rawFilePath); } catch { }
        // }

        // 3. Upload
        step = 'upload';
        console.log('Uploading to Netease Cloud Disk...');
        const uploadResult = await neteaseService.uploadToCloudDisk(finalFilePath);


        // 4. Cleanup
        try { fs.unlinkSync(finalFilePath); } catch { }

        return NextResponse.json({ success: true, uploadResult });
    } catch (e: any) {
        console.error(`Sync failed at step ${step}:`, e);
        return NextResponse.json({ error: e.message || 'Sync failed', step, details: String(e), stack: e.stack }, { status: 500 });
    }
}
