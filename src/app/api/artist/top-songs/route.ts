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
        // 1. Get Artist Detail to know the name. 
        // artist_detail requires a cookie which we may not have, but artist_top_song usually doesn't,
        // or we can fall back to directly grabbing the artist name from the first top song
        const cookie = request.headers.get('x-netease-cookie') || '';
        let artistName = '';

        try {
            const artist = await neteaseService.getArtistDetail(id, cookie);
            artistName = artist?.name || '';
        } catch (e) {
            console.warn('[Top Songs] Failed to get artist detail', e);
        }

        if (!artistName) {
            // Fallback: fetch top songs from netease and get the artist name from the first one
            const neteaseTopSongs = await neteaseService.getArtistTopSongs(id, cookie);
            if (neteaseTopSongs && neteaseTopSongs.length > 0) {
                const firstSongArtist = neteaseTopSongs[0]?.ar?.find((a: any) => String(a.id) === id);
                if (firstSongArtist) {
                    artistName = firstSongArtist.name;
                } else if (neteaseTopSongs[0]?.ar?.[0]) {
                    artistName = neteaseTopSongs[0].ar[0].name;
                }
            }
        }

        // Hardcoded Fallback for known IDs when Netease is completely down
        if (!artistName) {
            const fallbackMap: Record<string, string> = {
                '6452': '周杰伦',
                '2116': '陈奕迅',
                '3684': '林俊杰',
                '5781': '薛之谦',
                '6454': '张学友',
                '6458': '刘德华'
            };
            artistName = fallbackMap[id] || '';
        }

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
