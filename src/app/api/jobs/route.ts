import { NextResponse } from 'next/server';
import { ArtistSyncInput, JobType, SongSyncInput } from '@/core/types';
import { jobRunner } from '@/server/jobs/runner';

export const runtime = 'nodejs';

interface CreateJobRequest {
  type: JobType;
  input: Record<string, unknown>;
}

function isSongSyncInput(input: unknown): input is SongSyncInput {
  if (typeof input !== 'object' || input === null || !('info' in input)) {
    return false;
  }

  const info = (input as { info: Record<string, unknown> }).info;
  return typeof info.id === 'string' && typeof info.source === 'string';
}

function isArtistSyncInput(input: unknown): input is ArtistSyncInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    (typeof record.artistId === 'string' || typeof record.artistId === 'number') &&
    typeof record.artistName === 'string' &&
    typeof record.count === 'number'
  );
}

function withCookie<T extends object>(input: T, cookie: string): T & { neteaseCookie: string } {
  return {
    ...input,
    neteaseCookie: cookie,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to create job';
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateJobRequest;
    const cookie = request.headers.get('x-netease-cookie') || '';

    if (!body?.type || !body?.input) {
      return NextResponse.json({ error: 'Missing job type or input' }, { status: 400 });
    }

    if (body.type === 'sync_song') {
      if (!isSongSyncInput(body.input)) {
        return NextResponse.json({ error: 'Invalid sync_song input' }, { status: 400 });
      }
      const input = withCookie(body.input, cookie);
      const job = jobRunner.createJob('sync_song', input);
      jobRunner.start(job.id);
      return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
    }

    if (body.type === 'sync_artist') {
      if (!isArtistSyncInput(body.input)) {
        return NextResponse.json({ error: 'Invalid sync_artist input' }, { status: 400 });
      }
      const input = withCookie(body.input, cookie);
      const job = jobRunner.createJob('sync_artist', input);
      jobRunner.start(job.id);
      return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
    }

    return NextResponse.json({ error: 'Unsupported job type' }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || '20');

  return NextResponse.json({
    jobs: jobRunner.listJobs(Number.isNaN(limit) ? 20 : limit),
  });
}
