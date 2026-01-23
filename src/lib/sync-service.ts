import { downloadManager } from '@/lib/downloader';
import { neteaseService } from '@/lib/netease';
import { qqMusicService } from '@/lib/qqmusic';
import { embedMetadata, getSafeFileName } from '@/lib/metadata';
import path from 'path';
import fs from 'fs';
import { MusicInfo } from '@/lib/downloader/types';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

// Define Logger Type
export type Logger = (msg: string) => void;

interface SyncOptions {
    onLog?: Logger;
    skipUpload?: boolean; // For testing or local-only mode
    neteaseCookie?: string; // 客户端传入的网易云 Cookie
}

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

export async function processSongSync(
    baseInfo: MusicInfo,
    options: SyncOptions = {}
): Promise<any> {
    const log = options.onLog || console.log;
    const neteaseCookie = options.neteaseCookie;
    let downloadInfo: MusicInfo = { ...baseInfo };
    let lyrics = '';
    let rawFilePath = '';
    let finalFilePath = '';
    let step = 'init';

    try {
        log('==================================================');
        log(`[Processing] ${baseInfo.name} - ${baseInfo.artist}`);

        // ---------------------------------------------------------
        // 1. Pre-fetch Strategy (QQ Music First)
        // ---------------------------------------------------------
        step = 'prefetch';
        try {
            log(`[Strategy] Pre-fetching lyrics/info from QQ Music...`);
            const query = `${baseInfo.name} ${baseInfo.artist}`;
            const qqSongs = await qqMusicService.search(query);

            const isLive = (name: string) => /live|concert|现场|演唱会/i.test(name);
            const isTargetLive = isLive(baseInfo.name);
            let robustCandidate = null;
            let finalMatch = null;

            for (const qs of qqSongs) {
                const isCandidateLive = isLive(qs.name);

                if (isTargetLive) {
                    if (!isCandidateLive) {
                        if (!robustCandidate) robustCandidate = qs;
                        continue;
                    }
                } else {
                    if (isCandidateLive) {
                        if (!robustCandidate) robustCandidate = qs;
                        continue;
                    }
                }

                // Check Lyrics
                const lrc = await qqMusicService.getLyric(qs.id);
                if (lrc && lrc.length > 200) {
                    lyrics = lrc;
                    finalMatch = qs;
                    log(`[Strategy] Locked target via lyrics: ${qs.name}`);
                    break;
                }
            }

            if (!finalMatch && robustCandidate) {
                const qs = robustCandidate as any;
                const lrc = await qqMusicService.getLyric(qs.id);
                if (lrc && lrc.length > 200) {
                    lyrics = lrc;
                    finalMatch = qs;
                    log(`[Strategy] Using fallback target via lyrics: ${qs.name}`);
                }
            }

            if (finalMatch) {
                const qs = finalMatch;
                downloadInfo = {
                    ...downloadInfo,
                    duration: qs.dt / 1000,
                    album: qs.al.name,
                    artist: qs.ar.map((a: any) => a.name).join('/'),
                    // Force QQ song name if it's cleaner, but baseInfo name is usually fine
                    // Using baseInfo.name keeps original user intent, but QQ name might be more standard
                    songName: qs.name,
                    source: 'qq' // Explicitly set source to 'qq'
                };
                log(`[Strategy] Updated info with QQ Music data: Duration=${downloadInfo.duration}s`);
            } else {
                log(`[Strategy] No suitable QQ Music match found. Using original info.`);
            }

        } catch (e: any) {
            console.warn(`[Strategy] QQ Pre-fetch failed:`, e.message);
        }

        // ---------------------------------------------------------
        // 2. Download
        // ---------------------------------------------------------
        step = 'download';
        log(`Starting download logic...`);

        // If we still have 'netease' source (original) or no source, we must search for a downloadable source
        if (downloadInfo.source === 'netease' || !downloadInfo.source) {
            log(`[Strategy] Source is '${downloadInfo.source}', falling back to standard search...`);
            const searchQ = `${baseInfo.name} ${baseInfo.artist}`;
            const searchResults = await downloadManager.search(searchQ);

            // Filter live if possible
            const nonLiveMatches = searchResults.filter(res => !/live|concert|现场|演唱会/i.test(res.name));
            const bestMatch = nonLiveMatches.length > 0 ? nonLiveMatches[0] : searchResults[0];

            if (bestMatch) {
                log(`[Strategy] Standard search picked: ${bestMatch.name} (Source: ${bestMatch.source})`);
                // Use the found match as the basis for download, but keep our metadata (lyrics etc) if we had them
                // Actually, if we are here, we probably didn't find QQ lyrics either, or we did but QQ download failed? 
                // Wait, if QQ lyrics found (finalMatch triggers), source is 'qq', so we skip this.
                // So this only runs if QQ prefetch completely failed to find a "good" match.

                downloadInfo = {
                    ...downloadInfo, // Keep ID/OriginalID if possible? No, we need the new source's ID and Source.
                    // But we want to preserve the intended metadata (Name, Artist) for tagging?
                    // The 'downloadInfo' passed to getDownloadUrl MUST be the one from the search result 
                    // because it contains the hidden technical IDs (like YouTube video ID).

                    ...bestMatch, // OVerwrite with technical detaisl

                    // Restore metadata we want to enforce for the file tag (if we trusted baseInfo)
                    // But usually bestMatch has the correct technical name. 
                    // We'll trust bestMatch for downloading.
                };
            } else {
                throw new Error(`No downloadable source found for ${baseInfo.name}`);
            }
        }

        const downloadUrl = await downloadManager.getDownloadUrl(downloadInfo);

        // Handle "downloadUrl" being a remote URL vs a local file path
        // DownloadManager returns a LOCAL file path for YouTube/QQ sources.
        // But for consistency with legacy artist sync code that handled URLs, we support both.

        let ext = path.extname(downloadUrl).replace('.', '') || 'mp3';

        if (fs.existsSync(downloadUrl)) {
            // It's a local file
            rawFilePath = downloadUrl;

            // Log file size
            try {
                const stats = fs.statSync(rawFilePath);
                const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
                log(`Download complete: ${rawFilePath} (${fileSizeInMB} MB)`);
            } catch { }

        } else {
            // It's a URL (unlikely given current DownloadManager, but safe to keep)
            log(`Downloading from remote URL: ${downloadUrl}`);
            rawFilePath = path.join(TMP_DIR, `raw_${Date.now()}.mp3`);
            await downloadFile(downloadUrl, rawFilePath);
            ext = 'mp3';
        }

        const finalFileName = getSafeFileName(baseInfo.name, ext);
        finalFilePath = path.join(TMP_DIR, finalFileName);

        // If rawFilePath is different from finalFilePath, we might need to copy/move
        // embedMetadata handles 'rawFilePath' input and 'finalFilePath' output

        // ---------------------------------------------------------
        // 3. Metadata & Lyrics
        // ---------------------------------------------------------
        step = 'metadata';
        log('Embedding metadata...');

        if (!lyrics) {
            // Fallback to NetEase
            try {
                log(`[Lyrics] Searching NetEase fallback...`);
                // Use explicit song name + artist for search
                const searchQ = `${baseInfo.name} ${baseInfo.artist}`;
                const searchRes = await neteaseService.searchSong(searchQ, neteaseCookie);

                if (searchRes && searchRes.length > 0) {
                    const bestMatch = searchRes[0];
                    lyrics = await neteaseService.getLyric(bestMatch.id, neteaseCookie);

                    if (lyrics && lyrics.length < 200) {
                        log(`[Lyrics] NetEase lyrics short (${lyrics.length}), retrying 'Original'...`);
                        const retryQueries = [`${searchQ} 原版`, `${searchQ} 官方`];
                        for (const q of retryQueries) {
                            const retryRes = await neteaseService.searchSong(q, neteaseCookie);
                            if (retryRes?.[0]) {
                                const l = await neteaseService.getLyric(retryRes[0].id, neteaseCookie);
                                if (l && l.length > lyrics.length) {
                                    lyrics = l;
                                    log(`[Lyrics] Found better lyrics (${l.length} chars)`);
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // ignore
            }
        }

        if (lyrics) {
            log(`[Lyrics] Ready to embed (${lyrics.length} chars)`);
        } else {
            log(`[Lyrics] No lyrics found.`);
        }

        await embedMetadata(rawFilePath, finalFilePath, {
            title: baseInfo.name,
            artist: baseInfo.artist,
            album: downloadInfo.album || baseInfo.album || '',
            coverUrl: downloadInfo.coverUrl || baseInfo.coverUrl,
            lyrics: lyrics
        });

        // ---------------------------------------------------------
        // 4. Upload
        // ---------------------------------------------------------
        step = 'upload';
        if (options.skipUpload) {
            log('[Upload] Skipped (Dry Run)');
            return { skipped: true };
        }

        log('Uploading to Netease Cloud Disk...');
        const uploadResult = await neteaseService.uploadToCloudDisk(finalFilePath, neteaseCookie);

        let songId = null;
        if (uploadResult?.privateCloud?.songId) {
            songId = uploadResult.privateCloud.songId;
            log(`[Upload] Success! Private Cloud ID: ${songId}`);
        } else if (uploadResult?.songId) {
            songId = uploadResult.songId;
            log(`[Upload] Success! Public Match ID: ${songId}`);
        } else {
            log(`[Upload] Finished. Result Code: ${uploadResult?.code}`);
        }

        log('==================================================');

        return {
            ...uploadResult,
            songId // Ensure a consistent top-level songId is available
        };

    } catch (e: any) {
        log(`Error in processSongSync (Step: ${step}): ${e.message}`);
        throw e;
    } finally {
        // Cleanup
        // If rawFilePath exists and it was a temp file (not the one we just created as final), delete it
        if (rawFilePath && rawFilePath !== finalFilePath && fs.existsSync(rawFilePath)) {
            // In current DownloadManager, rawFilePath IS from tmp_downloads.
            // We generally want to keep cache?
            // Actually, route.ts logic was: raw path (downloaded) -> final path (tagged).
            // If raw path is preserved in DownloadManager for caching, we shouldn't delete it?
            // But if we downloaded it fresh here (from URL), we should.

            // Decisions:
            // 1. If we downloaded via DownloadManager, it manages the cache. We shouldn't delete rawFilePath if it's the cached file.
            // 2. We DO need to delete finalFilePath (the tagged version) after upload because it's unique per run.
            // 3. If rawFilePath was created uniquely here (e.g. from URL download), delete it.
        }

        if (finalFilePath && fs.existsSync(finalFilePath)) {
            try { fs.unlinkSync(finalFilePath); } catch { }
        }
    }
}
