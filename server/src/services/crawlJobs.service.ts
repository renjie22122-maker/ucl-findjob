import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error.js';
import { nowIso } from '../utils/time.js';
import { crawl } from '../adapters/registry.js';
import { importRecords } from './import.service.js';

export interface CrawlJob {
  id: number;
  sourceId: string;
  keyword: string;
  recruitType: 'school' | 'intern';
  maxPages: number;
  frequency: 'daily' | 'weekly';
  enabled: 0 | 1;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlRun {
  id: number;
  jobId: number | null;
  sourceId: string;
  keyword: string;
  status: 'running' | 'success' | 'failed';
  fetched: number;
  imported: number;
  skipped: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface JobRow {
  id: number;
  source_id: string;
  keyword: string;
  recruit_type: string;
  max_pages: number;
  frequency: string;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: number;
  job_id: number | null;
  source_id: string;
  keyword: string;
  status: string;
  fetched: number;
  imported: number;
  skipped: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

function toJob(row: JobRow): CrawlJob {
  return {
    id: row.id,
    sourceId: row.source_id,
    keyword: row.keyword,
    recruitType: row.recruit_type as CrawlJob['recruitType'],
    maxPages: row.max_pages,
    frequency: row.frequency as CrawlJob['frequency'],
    enabled: row.enabled as 0 | 1,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: RunRow): CrawlRun {
  return {
    id: row.id,
    jobId: row.job_id,
    sourceId: row.source_id,
    keyword: row.keyword,
    status: row.status as CrawlRun['status'],
    fetched: row.fetched,
    imported: row.imported,
    skipped: row.skipped,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export interface CrawlJobInput {
  sourceId: string;
  keyword: string;
  recruitType?: 'school' | 'intern';
  maxPages?: number;
  frequency?: 'daily' | 'weekly';
  enabled?: boolean;
}

export function listCrawlJobs(): CrawlJob[] {
  const rows = getDb().prepare('SELECT * FROM crawl_jobs ORDER BY id DESC').all() as JobRow[];
  return rows.map(toJob);
}

export function getCrawlJob(id: number): CrawlJob {
  const row = getDb().prepare('SELECT * FROM crawl_jobs WHERE id = ?').get(id) as JobRow | undefined;
  if (!row) throw AppError.notFound('抓取任务');
  return toJob(row);
}

export function createCrawlJob(input: CrawlJobInput): CrawlJob {
  const db = getDb();
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO crawl_jobs (source_id, keyword, recruit_type, max_pages, frequency, enabled, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      input.sourceId,
      input.keyword.trim(),
      input.recruitType ?? 'school',
      Math.min(10, Math.max(1, input.maxPages ?? 3)),
      input.frequency ?? 'daily',
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
  return getCrawlJob(Number(info.lastInsertRowid));
}

export function updateCrawlJob(id: number, input: Partial<CrawlJobInput>): CrawlJob {
  const db = getDb();
  const current = getCrawlJob(id);
  db.prepare(
    `UPDATE crawl_jobs SET
       source_id = ?, keyword = ?, recruit_type = ?, max_pages = ?, frequency = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.sourceId ?? current.sourceId,
    (input.keyword ?? current.keyword).trim(),
    input.recruitType ?? current.recruitType,
    input.maxPages ? Math.min(10, Math.max(1, input.maxPages)) : current.maxPages,
    input.frequency ?? current.frequency,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    nowIso(),
    id,
  );
  return getCrawlJob(id);
}

export function deleteCrawlJob(id: number): void {
  const db = getDb();
  const row = db.prepare('SELECT id FROM crawl_jobs WHERE id = ?').get(id);
  if (!row) throw AppError.notFound('抓取任务');
  db.prepare('DELETE FROM crawl_jobs WHERE id = ?').run(id);
}

/** 任务是否到期（纯函数，便于单测） */
export function isJobDue(job: CrawlJob, now = new Date()): boolean {
  if (!job.enabled) return false;
  if (!job.lastRunAt) return true;
  const lastDay = job.lastRunAt.slice(0, 10);
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const diffDays = Math.floor((new Date(today).getTime() - new Date(lastDay).getTime()) / 86400_000);
  if (job.frequency === 'weekly') return diffDays >= 7;
  return diffDays >= 1;
}

export function listCrawlRuns(filters: { jobId?: number; page?: number; pageSize?: number } = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.jobId) {
    conditions.push('job_id = ?');
    params.push(filters.jobId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM crawl_runs ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM crawl_runs ${where} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as RunRow[];
  return { items: rows.map(toRun), total, page, pageSize };
}

/** 执行一次抓取任务：抓取 → 统一管线导入 → 记录运行历史（去重由 ImportService 保证） */
export async function runCrawlJob(jobId: number): Promise<CrawlRun> {
  const db = getDb();
  const job = getCrawlJob(jobId);
  const startedAt = nowIso();
  const info = db
    .prepare(
      `INSERT INTO crawl_runs (job_id, source_id, keyword, status, fetched, imported, skipped, error, started_at, finished_at)
       VALUES (?, ?, ?, 'running', 0, 0, 0, NULL, ?, NULL)`,
    )
    .run(job.id, job.sourceId, job.keyword, startedAt);
  const runId = Number(info.lastInsertRowid);

  try {
    const result = await crawl(job.sourceId, {
      keyword: job.keyword,
      recruitType: job.recruitType,
      maxPages: job.maxPages,
    });
    const importResult = importRecords(result.records);
    db.prepare(
      `UPDATE crawl_runs SET status = 'success', fetched = ?, imported = ?, skipped = ?, finished_at = ? WHERE id = ?`,
    ).run(result.count, importResult.imported, importResult.skipped, nowIso(), runId);
    // 成功与失败都更新 last_run_at：失败时避免每分钟重试风暴，等下一个周期
    db.prepare('UPDATE crawl_jobs SET last_run_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE crawl_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
    ).run(message.slice(0, 500), nowIso(), runId);
    db.prepare('UPDATE crawl_jobs SET last_run_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), job.id);
    console.error(`[crawl-job] 任务「${job.keyword}」执行失败：${message}`);
  }

  const row = db.prepare('SELECT * FROM crawl_runs WHERE id = ?').get(runId) as RunRow;
  return toRun(row);
}
