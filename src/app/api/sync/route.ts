import { NextResponse } from 'next/server';
import { MusicInfo } from '@/lib/downloader/types';
import { jobRunner } from '@/server/jobs/runner';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Sync failed';
}

export async function POST(request: Request) {
    try {
        const info: MusicInfo = await request.json();

        if (!info || !info.id || !info.source) {
            return NextResponse.json({ error: 'Invalid music info' }, { status: 400 });
        }

        const cookie = request.headers.get('x-netease-cookie') || '';
        const job = jobRunner.createJob('sync_song', {
            info,
            neteaseCookie: cookie
        });
        jobRunner.start(job.id);

        return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });

    } catch (error: unknown) {
        console.error(`Sync failed:`, error);
        return NextResponse.json({
            error: getErrorMessage(error),
            details: String(error)
        }, { status: 500 });
    }
}
