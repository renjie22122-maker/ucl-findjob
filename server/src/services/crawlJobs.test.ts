import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/connection.js';
import { createCrawlJob, isJobDue, listCrawlJobs, listCrawlRuns, updateCrawlJob } from './crawlJobs.service.js';
import type { CrawlJob } from './crawlJobs.service.js';

function makeJob(overrides: Partial<CrawlJob>): CrawlJob {
  return {
    id: 1,
    sourceId: 'nowcoder',
    keyword: '后端',
    recruitType: 'school',
    maxPages: 3,
    frequency: 'daily',
    enabled: 1,
    lastRunAt: null,
    createdAt: '2026-01-01T00:00:00',
    updatedAt: '2026-01-01T00:00:00',
    ...overrides,
  };
}

describe('定时抓取任务', () => {
  it('从未运行过的启用任务到期', () => {
    expect(isJobDue(makeJob({ lastRunAt: null }))).toBe(true);
  });

  it('今天已运行的不再到期；昨天运行的 daily 到期', () => {
    const today = new Date();
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(isJobDue(makeJob({ lastRunAt: `${ymd(today)}T08:00:00` }))).toBe(false);
    const yesterday = new Date(today.getTime() - 86400_000);
    expect(isJobDue(makeJob({ lastRunAt: `${ymd(yesterday)}T08:00:00` }))).toBe(true);
  });

  it('weekly 任务 7 天内不重复执行', () => {
    const today = new Date();
    const daysAgo = (n: number) => new Date(today.getTime() - n * 86400_000);
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(isJobDue(makeJob({ frequency: 'weekly', lastRunAt: `${ymd(daysAgo(6))}T08:00:00` }))).toBe(false);
    expect(isJobDue(makeJob({ frequency: 'weekly', lastRunAt: `${ymd(daysAgo(7))}T08:00:00` }))).toBe(true);
  });

  it('停用任务永不到期', () => {
    expect(isJobDue(makeJob({ enabled: 0, lastRunAt: null }))).toBe(false);
  });
});

describe('抓取任务 CRUD', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec('DELETE FROM crawl_jobs; DELETE FROM crawl_runs;');
  });

  it('创建/更新/停用/删除', () => {
    const job = createCrawlJob({ sourceId: 'nowcoder', keyword: '算法', recruitType: 'intern', maxPages: 5, frequency: 'weekly' });
    expect(job.keyword).toBe('算法');
    expect(job.maxPages).toBe(5);
    expect(job.enabled).toBe(1);

    const updated = updateCrawlJob(job.id, { enabled: false, maxPages: 2 });
    expect(updated.enabled).toBe(0);
    expect(updated.maxPages).toBe(2);
    expect(isJobDue(updated)).toBe(false);

    expect(listCrawlJobs()).toHaveLength(1);
    expect(listCrawlRuns()).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('maxPages 钳制在 1-10', () => {
    expect(createCrawlJob({ sourceId: 'nowcoder', keyword: 'x', maxPages: 99 }).maxPages).toBe(10);
    expect(createCrawlJob({ sourceId: 'nowcoder', keyword: 'y', maxPages: 0 }).maxPages).toBe(1);
  });
});
