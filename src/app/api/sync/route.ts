import { NextResponse } from 'next/server';
import { processSongSync } from '@/lib/sync-service';
import { MusicInfo } from '@/lib/downloader/types';

export async function POST(request: Request) {
    try {
        const info: MusicInfo = await request.json();

        if (!info || !info.id || !info.source) {
            return NextResponse.json({ error: 'Invalid music info' }, { status: 400 });
        }

        // Use the shared sync service
        // We pass console.log to output logs to the server console as before
        const result = await processSongSync(info, {
            onLog: (msg) => console.log(msg)
        });

        return NextResponse.json({ success: true, uploadResult: result });

    } catch (e: any) {
        console.error(`Sync failed:`, e);
        return NextResponse.json({
            error: e.message || 'Sync failed',
            details: String(e),
            stack: e.stack
        }, { status: 500 });
    }
}
