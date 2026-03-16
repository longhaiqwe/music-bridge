import { downloadManager } from '@/lib/downloader';
import { neteaseService } from '@/lib/netease';
import { qqMusicService } from '@/lib/qqmusic';
import { embedMetadata, getSafeFileName } from '@/lib/metadata';
import path from 'path';
import fs from 'fs';
import { MusicInfo } from '@/lib/downloader/types';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { SongSyncEvent } from '@/core/types';
import { SongInfo } from '@/lib/qqmusic';
import { Readable } from 'stream';

// Define Logger Type
export type Logger = (msg: string) => void;

interface SyncOptions {
    onLog?: Logger;
    skipUpload?: boolean; // For testing or local-only mode
    neteaseCookie?: string; // 客户端传入的网易云 Cookie
    onEvent?: (event: SongSyncEvent) => void;
}

interface UploadResult extends Record<string, unknown> {
    code?: number;
    songId?: string | number | null;
    skipped?: boolean;
    privateCloud?: {
        songId?: string | number;
    };
}

const QQ_LYRIC_BATCH_SIZE = 2;

// Helper to download file
async function downloadFile(url: string, dest: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download: ${res.statusText}`);
    if (!res.body) throw new Error('No body');
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

async function findLyricsMatchInBatches<T>(
    items: T[],
    getLyrics: (item: T) => Promise<string>,
    batchSize = QQ_LYRIC_BATCH_SIZE,
    minLength = 200
): Promise<{ item: T; lyrics: string } | null> {
    for (let start = 0; start < items.length; start += batchSize) {
        const batch = items.slice(start, start + batchSize);
        const batchResults = await Promise.all(
            batch.map(async (item) => ({
                item,
                lyrics: await getLyrics(item)
            }))
        );

        const match = batchResults.find((result) => result.lyrics.length > minLength);
        if (match) {
            return match;
        }
    }

    return null;
}

export async function processSongSync(
    baseInfo: MusicInfo,
    options: SyncOptions = {}
): Promise<UploadResult> {
    const log = options.onLog || console.log;
    const emit = options.onEvent || (() => undefined);
    const neteaseCookie = options.neteaseCookie;
    let downloadInfo: MusicInfo = { ...baseInfo };
    let lyrics = '';
    let rawFilePath = '';
    let finalFilePath = '';
    let step = 'init';

    try {
        log('==================================================');
        log(`[Processing] ${baseInfo.name} - ${baseInfo.artist}`);
        emit({
            type: 'song.prefetch_started',
            message: '正在准备音源信息...',
            data: { songName: baseInfo.name }
        });

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
            const prioritizedCandidates: SongInfo[] = [];
            let robustCandidate: SongInfo | null = null;
            let finalMatch: SongInfo | null = null;

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

                prioritizedCandidates.push(qs);
            }

            const primaryMatch = await findLyricsMatchInBatches(
                prioritizedCandidates,
                (song) => qqMusicService.getLyric(song.id)
            );

            if (primaryMatch) {
                lyrics = primaryMatch.lyrics;
                finalMatch = primaryMatch.item;
                log(`[Strategy] Locked target via lyrics: ${primaryMatch.item.name}`);
            }

            if (!finalMatch && robustCandidate) {
                const qs = robustCandidate;
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
                    artist: qs.ar.map((artist) => artist.name).join('/'),
                    // Force QQ song name if it's cleaner, but baseInfo name is usually fine
                    // Using baseInfo.name keeps original user intent, but QQ name might be more standard
                    songName: qs.name,
                    source: 'qq' // Explicitly set source to 'qq'
                };
                log(`[Strategy] Updated info with QQ Music data: Duration=${downloadInfo.duration}s`);
            } else {
                log(`[Strategy] No suitable QQ Music match found. Using original info.`);
            }

        } catch (error: unknown) {
            console.warn(`[Strategy] QQ Pre-fetch failed:`, error instanceof Error ? error.message : String(error));
        }

        // ---------------------------------------------------------
        // 2. Download
        // ---------------------------------------------------------
        step = 'download';
        log(`Starting download logic...`);
        emit({
            type: 'song.download_started',
            message: '正在下载音频...',
            data: { songName: baseInfo.name }
        });

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

        let ext = path.extname(downloadUrl).replace('.', '') || 'flac';

        if (fs.existsSync(downloadUrl)) {
            // It's a local file
            rawFilePath = downloadUrl;

            // Log file size
            try {
                const stats = fs.statSync(rawFilePath);
                const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
                log(`Download complete: ${rawFilePath} (${fileSizeInMB} MB)`);
                emit({
                    type: 'song.downloaded',
                    message: `下载完成 (${fileSizeInMB} MB)`,
                    data: { songName: baseInfo.name, fileSizeInMB }
                });
            } catch { }

        } else {
            // It's a URL (unlikely given current DownloadManager, but safe to keep)
            log(`Downloading from remote URL: ${downloadUrl}`);
            rawFilePath = path.join(TMP_DIR, `raw_${Date.now()}.flac`);
            await downloadFile(downloadUrl, rawFilePath);
            ext = 'flac';
            emit({
                type: 'song.downloaded',
                message: '下载完成',
                data: { songName: baseInfo.name }
            });
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
        emit({
            type: 'song.metadata_started',
            message: '正在写入元数据...',
            data: { songName: baseInfo.name }
        });

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

                        const retryResults = await Promise.all(
                            retryQueries.map(async (q) => {
                                const retryRes = await neteaseService.searchSong(q, neteaseCookie);
                                if (!retryRes?.[0]) {
                                    return null;
                                }

                                const retryLyrics = await neteaseService.getLyric(retryRes[0].id, neteaseCookie);
                                return retryLyrics
                                    ? { query: q, lyrics: retryLyrics }
                                    : null;
                            })
                        );

                        const betterLyrics = retryResults
                            .filter((result): result is { query: string; lyrics: string } => Boolean(result))
                            .sort((a, b) => b.lyrics.length - a.lyrics.length)[0];

                        if (betterLyrics && betterLyrics.lyrics.length > lyrics.length) {
                            lyrics = betterLyrics.lyrics;
                            log(`[Lyrics] Found better lyrics via "${betterLyrics.query}" (${betterLyrics.lyrics.length} chars)`);
                        }
                    }
                }
            } catch {
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
        emit({
            type: 'song.metadata_embedded',
            message: '元数据写入完成',
            data: { songName: baseInfo.name }
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
        emit({
            type: 'song.upload_started',
            message: '正在上传到云盘...',
            data: { songName: baseInfo.name }
        });
        const uploadResult = await neteaseService.uploadToCloudDisk(finalFilePath, neteaseCookie) as UploadResult;

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
        emit({
            type: 'song.uploaded',
            message: '上传完成',
            data: { songName: baseInfo.name, songId: songId || undefined }
        });

        return {
            ...uploadResult,
            songId // Ensure a consistent top-level songId is available
        };

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '同步失败';
        log(`Error in processSongSync (Step: ${step}): ${message}`);
        emit({
            type: 'song.failed',
            message,
            data: { songName: baseInfo.name, step }
        });
        throw error;
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
