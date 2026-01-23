import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
        return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
    }

    try {
        console.log('==================================================');
        console.log(`[Artist Search] Query: ${q}`);
        const artists = await neteaseService.searchArtist(q);
        console.log(`[Artist Search] Found ${artists.length} artists`);
        console.log('==================================================');
        return NextResponse.json(artists);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
