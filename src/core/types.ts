import { MusicInfo } from '@/lib/downloader/types';

export type JobType = 'sync_song' | 'sync_artist';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobProgress {
  current: number;
  total: number;
  message: string;
  songName?: string;
}

export interface SongSyncInput {
  info: MusicInfo;
  neteaseCookie?: string;
}

export interface ArtistSyncSong {
  id: number | string;
  name: string;
  ar?: Array<{ id?: number | string; name: string }>;
  artists?: Array<{ id?: number | string; name: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  source?: string;
}

export interface ArtistSyncInput {
  artistId: number | string;
  artistName: string;
  count: number;
  songs?: ArtistSyncSong[];
  createPlaylist?: boolean;
  neteaseCookie?: string;
}

export interface SongSyncResult {
  uploadResult: unknown;
  songId?: string | number | null;
}

export interface ArtistSyncResult {
  success: number;
  failed: number;
  failedSongs: string[];
  playlistId?: string | number | null;
}

export interface JobEvent {
  seq: number;
  at: string;
  type: string;
  message: string;
  progress?: Partial<JobProgress>;
  data?: Record<string, unknown>;
}

export interface JobRecord<TInput = unknown, TResult = unknown> {
  id: string;
  type: JobType;
  status: JobStatus;
  input: TInput;
  progress: JobProgress;
  events: JobEvent[];
  result?: TResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SongSyncEvent {
  type:
    | 'song.started'
    | 'song.prefetch_started'
    | 'song.download_started'
    | 'song.downloaded'
    | 'song.metadata_started'
    | 'song.metadata_embedded'
    | 'song.upload_started'
    | 'song.uploaded'
    | 'song.failed';
  message: string;
  data?: Record<string, unknown>;
}
