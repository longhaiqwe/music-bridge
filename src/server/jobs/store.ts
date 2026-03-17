import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { JobEvent, JobProgress, JobRecord, JobStatus, JobType } from '@/core/types';

interface CreateJobParams<TInput> {
  type: JobType;
  input: TInput;
}

interface JobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  input_json: string;
  progress_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  seq: number;
  at: string;
  type: string;
  message: string;
  progress_json: string | null;
  data_json: string | null;
}

const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000;

function createInitialProgress(): JobProgress {
  return {
    current: 0,
    total: 0,
    message: '已创建任务',
  };
}

function getDbPath() {
  const dataDir = path.join(process.cwd(), '.data');
  mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'music-bridge.sqlite');
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

class SqliteJobStore {
  private db: DatabaseSync | null = null;

  private getDb() {
    if (this.db) {
      return this.db;
    }

    this.db = new DatabaseSync(getDbPath());
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
    `);
    this.init();
    return this.db;
  }

  private init() {
    const db = this.getDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_events (
        job_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        progress_json TEXT,
        data_json TEXT,
        PRIMARY KEY (job_id, seq),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_job_events_job_id_seq ON job_events(job_id, seq);
    `);

    const staleBefore = new Date(Date.now() - STALE_JOB_TIMEOUT_MS).toISOString();

    db
      .prepare(`
        UPDATE jobs
        SET status = 'failed',
            error = COALESCE(error, 'Server restarted before completion'),
            updated_at = ?
        WHERE status IN ('queued', 'running')
          AND updated_at < ?
      `)
      .run(new Date().toISOString(), staleBefore);
  }

  private mapJobRow<TInput = unknown, TResult = unknown>(row: JobRow | undefined): JobRecord<TInput, TResult> | undefined {
    if (!row) return undefined;

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      input: parseJson<TInput>(row.input_json, {} as TInput),
      progress: parseJson<JobProgress>(row.progress_json, createInitialProgress()),
      result: parseJson<TResult | undefined>(row.result_json ?? undefined, undefined),
      error: row.error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events: [],
    };
  }

  private mapEventRow(row: EventRow): JobEvent {
    return {
      seq: row.seq,
      at: row.at,
      type: row.type,
      message: row.message,
      progress: parseJson<Partial<JobProgress> | undefined>(row.progress_json ?? undefined, undefined),
      data: parseJson<Record<string, unknown> | undefined>(row.data_json ?? undefined, undefined),
    };
  }

  create<TInput>({ type, input }: CreateJobParams<TInput>): JobRecord<TInput> {
    const db = this.getDb();
    const id = `job_${randomUUID()}`;
    const now = new Date().toISOString();
    const progress = createInitialProgress();

    db
      .prepare(`
        INSERT INTO jobs (id, type, status, input_json, progress_json, created_at, updated_at)
        VALUES (?, ?, 'queued', ?, ?, ?, ?)
      `)
      .run(id, type, JSON.stringify(input), JSON.stringify(progress), now, now);

    return {
      id,
      type,
      status: 'queued',
      input,
      progress,
      events: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  get<TInput = unknown, TResult = unknown>(id: string): JobRecord<TInput, TResult> | undefined {
    const row = this.getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return this.mapJobRow<TInput, TResult>(row);
  }

  list(limit = 20) {
    const rows = this.getDb()
      .prepare('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as JobRow[];

    return rows
      .map((row) => this.mapJobRow(row))
      .filter((job): job is JobRecord<unknown, unknown> => Boolean(job));
  }

  updateStatus(id: string, status: JobStatus, error?: string) {
    this.getDb()
      .prepare(`
        UPDATE jobs
        SET status = ?, error = COALESCE(?, error), updated_at = ?
        WHERE id = ?
      `)
      .run(status, error ?? null, new Date().toISOString(), id);
  }

  updateProgress(id: string, progress: Partial<JobProgress>) {
    const job = this.get(id);
    if (!job) return;

    this.getDb()
      .prepare(`
        UPDATE jobs
        SET progress_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(JSON.stringify({ ...job.progress, ...progress }), new Date().toISOString(), id);
  }

  appendEvent(id: string, event: Omit<JobEvent, 'seq' | 'at'>) {
    const db = this.getDb();
    const nextSeqRow = db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM job_events WHERE job_id = ?')
      .get(id) as { seq: number };
    const seq = nextSeqRow.seq + 1;
    const at = new Date().toISOString();

    db
      .prepare(`
        INSERT INTO job_events (job_id, seq, at, type, message, progress_json, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        seq,
        at,
        event.type,
        event.message,
        event.progress ? JSON.stringify(event.progress) : null,
        event.data ? JSON.stringify(event.data) : null
      );

    db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(at, id);
  }

  complete<TResult>(id: string, result: TResult) {
    this.getDb()
      .prepare(`
        UPDATE jobs
        SET result_json = ?, status = 'succeeded', updated_at = ?
        WHERE id = ?
      `)
      .run(JSON.stringify(result), new Date().toISOString(), id);
  }

  fail(id: string, error: string) {
    this.getDb()
      .prepare(`
        UPDATE jobs
        SET error = ?, status = 'failed', updated_at = ?
        WHERE id = ?
      `)
      .run(error, new Date().toISOString(), id);
  }

  listEvents(id: string, since = 0) {
    const rows = this.getDb()
      .prepare(`
        SELECT seq, at, type, message, progress_json, data_json
        FROM job_events
        WHERE job_id = ? AND seq > ?
        ORDER BY seq ASC
      `)
      .all(id, since) as EventRow[];

    return rows.map((row) => this.mapEventRow(row));
  }
}

export const jobStore = new SqliteJobStore();
