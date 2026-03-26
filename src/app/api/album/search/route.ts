import { NextResponse } from 'next/server';
import { qqMusicService } from '@/lib/qqmusic';
import { workflowLog } from '@/lib/logging';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
        return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
    }

    try {
        workflowLog('==================================================');
        workflowLog(`[Album Search] Query: ${q}`);
        const albums = await qqMusicService.searchAlbums(q);
        workflowLog(`[Album Search] Found ${albums.length} albums`);
        workflowLog('==================================================');
        return NextResponse.json(albums);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
