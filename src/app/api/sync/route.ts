import { NextResponse } from 'next/server';
import { downloadManager } from '@/lib/downloader';
import { neteaseService } from '@/lib/netease';
import fs from 'fs';
import { MusicInfo } from '@/lib/downloader/types';

export async function POST(request: Request) {
    try {
        const info: MusicInfo = await request.json();

        if (!info || !info.id || !info.source) {
            return NextResponse.json({ error: 'Invalid music info' }, { status: 400 });
        }

        // 1. Download
        console.log(`Starting download for: ${info.name} from ${info.source}`);
        const filePath = await downloadManager.getDownloadUrl(info);
        console.log(`Downloaded to: ${filePath}`);

        // 2. Upload
        console.log('Uploading to Netease Cloud Disk...');
        const uploadResult = await neteaseService.uploadToCloudDisk(filePath);
        console.log('Upload result:', uploadResult);

        // 3. Cleanup (Optional, keep for debugging or cache)
        // fs.unlinkSync(filePath); 

        return NextResponse.json({ success: true, uploadResult });
    } catch (e: any) {
        console.error('Sync failed:', e);
        return NextResponse.json({ error: e.message || 'Sync failed', details: String(e), stack: e.stack }, { status: 500 });
    }
}
