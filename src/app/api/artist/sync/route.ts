import { NextResponse } from 'next/server';
import { ArtistSyncInput } from '@/core/types';
import { jobRunner } from '@/server/jobs/runner';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Failed to create sync job';
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as Partial<ArtistSyncInput>;
        const { artistId, count = 10, artistName, songs, createPlaylist = true } = body;
        const cookie = request.headers.get('x-netease-cookie') || '';

        if (!artistId || !artistName) {
            return NextResponse.json({ error: 'Missing artistId or artistName' }, { status: 400 });
        }

        const job = jobRunner.createJob('sync_artist', {
            artistId,
            artistName,
            count,
            songs,
            createPlaylist,
            neteaseCookie: cookie
        });
        jobRunner.start(job.id);

        return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
