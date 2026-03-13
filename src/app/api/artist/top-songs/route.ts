import { NextResponse } from 'next/server';
import { getArtistSyncSongs } from '@/core/artist-songs';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'Missing artist id' }, { status: 400 });
    }

    try {
        const songs = await getArtistSyncSongs(id);
        if (songs.length === 0) {
            return NextResponse.json({ error: 'Artist not found' }, { status: 404 });
        }

        return NextResponse.json(songs);

    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
