import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import {
  createCrawlJob,
  deleteCrawlJob,
  getCrawlJob,
  listCrawlJobs,
  listCrawlRuns,
  updateCrawlJob,
} from '../services/crawlJobs.service.js';
import { enqueueJobRun } from '../scheduler.js';

/** GET /api/crawl-jobs */
export const crawlJobsRouter = Router();

crawlJobsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: listCrawlJobs() });
  }),
);

const jobSchema = z.object({
  sourceId: z.string(),
  keyword: z.string().trim().min(1, '关键词不能为空').max(50),
  recruitType: z.enum(['school', 'intern']).optional(),
  maxPages: z.number().int().min(1).max(10).optional(),
  frequency: z.enum(['daily', 'weekly']).optional(),
  enabled: z.boolean().optional(),
});

crawlJobsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(jobSchema, req.body);
    res.status(201).json(createCrawlJob(input));
  }),
);

crawlJobsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(jobSchema.partial(), req.body);
    res.json(updateCrawlJob(parseId(req.params.id), input));
  }),
);

crawlJobsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteCrawlJob(parseId(req.params.id));
    res.status(204).end();
  }),
);

crawlJobsRouter.post(
  '/:id/run-now',
  asyncHandler(async (req, res) => {
    getCrawlJob(parseId(req.params.id)); // 校验存在
    enqueueJobRun(parseId(req.params.id));
    res.status(202).json({ started: true });
  }),
);

/** GET /api/crawl-runs —— 运行历史 */
export const crawlRunsRouter = Router();

crawlRunsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query;
    res.json(
      listCrawlRuns({
        jobId: q.jobId ? Number(q.jobId) : undefined,
        page: q.page ? Number(q.page) : 1,
        pageSize: q.pageSize ? Number(q.pageSize) : 20,
      }),
    );
  }),
);
