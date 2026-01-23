import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';
import { qqMusicService } from '@/lib/qqmusic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'Missing artist id' }, { status: 400 });
    }

    try {
        // 1. Get Artist Detail to know the name
        const cookie = request.headers.get('x-netease-cookie') || undefined;
        const artist = await neteaseService.getArtistDetail(id, cookie);
        const artistName = artist.name;

        if (!artistName) {
            return NextResponse.json({ error: 'Artist not found' }, { status: 404 });
        }

        // 2. Fetch QQ Music Hot Songs directly
        const qqSongs = await qqMusicService.getArtistHotSongs(artistName);

        console.log(`[QQ Source] Artist: ${artistName}, Songs found: ${qqSongs.length}`);

        // 3. Return formatted songs directly
        return NextResponse.json(qqSongs);

    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
