import { NextResponse } from 'next/server';
import { qqMusicService } from '@/lib/qqmusic';
import { debugLog } from '@/lib/logging';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
        return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
    }

    try {
        debugLog('==================================================');
        debugLog(`[Album Search] Query: ${q}`);
        const albums = await qqMusicService.searchAlbums(q);
        debugLog(`[Album Search] Found ${albums.length} albums`);
        debugLog('==================================================');
        return NextResponse.json(albums);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
