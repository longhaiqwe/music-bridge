import { NextResponse } from 'next/server';
import { jobStore } from '@/server/jobs/store';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const job = jobStore.get(id);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get('since') || '0');
  const events = jobStore.listEvents(id, Number.isNaN(since) ? 0 : since);

  return NextResponse.json({
    jobId: id,
    events,
    nextCursor: events.length > 0 ? events[events.length - 1].seq : since,
  });
}

