import {
  ArtistSyncInput,
  ArtistSyncResult,
  JobEvent,
  JobRecord,
  JobType,
  SongSyncInput,
  SongSyncResult,
} from '@/core/types';
import { runArtistSync } from '@/core/sync-artist';
import { runSongSync } from '@/core/sync-song';
import { jobStore } from '@/server/jobs/store';

type JobInput = SongSyncInput | ArtistSyncInput;
type JobResult = SongSyncResult | ArtistSyncResult;

function toJobEvent(event: { type: string; message: string; data?: Record<string, unknown> }): Omit<JobEvent, 'seq' | 'at'> {
  return {
    type: event.type,
    message: event.message,
    data: event.data,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '任务执行失败';
}

class JobRunner {
  createJob<TInput extends JobInput>(type: JobType, input: TInput): JobRecord<TInput> {
    return jobStore.create({ type, input });
  }

  start(jobId: string) {
    queueMicrotask(async () => {
      const job = jobStore.get<JobInput, JobResult>(jobId);
      if (!job) return;

      jobStore.updateStatus(jobId, 'running');
      jobStore.appendEvent(jobId, {
        type: 'job.started',
        message: '任务开始执行',
      });

      try {
        if (job.type === 'sync_song') {
          const result = await runSongSync(job.input as SongSyncInput, {
            onEvent: (event) => {
              jobStore.appendEvent(jobId, toJobEvent(event));
              jobStore.updateProgress(jobId, {
                current: 1,
                total: 1,
                message: event.message,
                songName: (event.data?.songName as string | undefined) || (job.input as SongSyncInput).info.name,
              });
            },
          });
          jobStore.complete(jobId, result);
        } else {
          const result = await runArtistSync(job.input as ArtistSyncInput, {
            onEvent: (event) => {
              jobStore.appendEvent(jobId, toJobEvent(event));
            },
            onProgress: (progress) => {
              jobStore.updateProgress(jobId, progress);
            },
          });
          jobStore.complete(jobId, result);
        }

        jobStore.appendEvent(jobId, {
          type: 'job.completed',
          message: '任务执行完成',
        });
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        jobStore.fail(jobId, message);
        jobStore.appendEvent(jobId, {
          type: 'job.failed',
          message,
        });
      }
    });
  }

  listJobs(limit = 20) {
    return jobStore.list(limit);
  }
}

export const jobRunner = new JobRunner();
