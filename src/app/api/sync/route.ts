import { NextResponse } from 'next/server';
import { downloadManager } from '@/lib/downloader';
import { neteaseService } from '@/lib/netease';
import fs from 'fs';
import { MusicInfo } from '@/lib/downloader/types';

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
        const filePath = await downloadManager.getDownloadUrl(info);
        console.log(`Downloaded to: ${filePath}`);

        // 2. Upload
        step = 'upload';
        console.log('Uploading to Netease Cloud Disk...');
        const uploadResult = await neteaseService.uploadToCloudDisk(filePath);
        console.log('Upload result:', uploadResult);

        // 3. Cleanup (Optional, keep for debugging or cache)
        // fs.unlinkSync(filePath); 

        return NextResponse.json({ success: true, uploadResult });
    } catch (e: any) {
        console.error(`Sync failed at step ${step}:`, e);
        return NextResponse.json({ error: e.message || 'Sync failed', step, details: String(e), stack: e.stack }, { status: 500 });
    }
}
