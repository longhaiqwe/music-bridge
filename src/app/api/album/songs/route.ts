import { NextResponse } from 'next/server';
import { getAlbumSyncSongs } from '@/core/album-songs';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'Missing album id' }, { status: 400 });
    }

    try {
        const songs = await getAlbumSyncSongs(id);
        if (songs.length === 0) {
            return NextResponse.json({ error: 'Album not found' }, { status: 404 });
        }

        return NextResponse.json(songs);

    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
