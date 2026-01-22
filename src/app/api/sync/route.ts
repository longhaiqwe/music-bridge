import { NextResponse } from 'next/server';
import { downloadManager } from '@/lib/downloader';
import { neteaseService } from '@/lib/netease';
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

        // 1. Download
        step = 'download';
        console.log(`Starting download for: ${info.name} from ${info.source}`);
        const rawFilePath = await downloadManager.getDownloadUrl(info);
        console.log(`Downloaded to: ${rawFilePath}`);

        // 2. Embed metadata
        step = 'metadata';
        console.log('Embedding metadata...');

        // Fetch Lyrics (Best Effort)
        let lyrics = '';
        try {
            console.log(`[Lyrics] Searching NetEase for: ${info.name} ${info.artist}`);
            const query = `${info.name} ${info.artist}`;
            const searchRes = await neteaseService.searchSong(query);

            if (searchRes && searchRes.length > 0) {
                // Determine best match? For now just pick first
                const bestMatch = searchRes[0];
                console.log(`[Lyrics] Found match: ${bestMatch.name} (ID: ${bestMatch.id})`);

                lyrics = await neteaseService.getLyric(bestMatch.id);
                if (lyrics) {
                    console.log(`[Lyrics] Successfully fetched lyrics (${lyrics.length} chars)`);
                } else {
                    console.log('[Lyrics] Lyrics empty');
                }
            } else {
                console.log('[Lyrics] No match found on NetEase');
            }
        } catch (e) {
            console.warn('[Lyrics] Failed to fetch lyrics', e);
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
