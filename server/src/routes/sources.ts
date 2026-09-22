import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/error.js';
import { parse } from '../middleware/validate.js';
import { crawl, crawlMany, listSources } from '../adapters/registry.js';

/** GET /api/sources —— 数据源注册表 */
export const sourcesRouter = Router();

sourcesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: listSources() });
  }),
);

const paramsSchema = z.object({
  keyword: z.string().optional(),
  recruitType: z.enum(['school', 'intern']).optional(),
  maxPages: z.number().int().min(1).max(10).optional(),
});

const crawlSchema = z.object({
  sourceId: z.string(),
  params: paramsSchema,
});

const crawlManySchema = z.object({
  sourceIds: z.array(z.string()).min(1, '至少选择一个数据源'),
  params: paramsSchema,
});

/** POST /api/crawl —— 触发爬虫抓取（单源） */
export const crawlRouter = Router();

crawlRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(crawlSchema, req.body);
    res.status(201).json(await crawl(input.sourceId, input.params));
  }),
);

/** POST /api/crawl/many —— 聚合抓取多数据源并合并去重（M9） */
crawlRouter.post(
  '/many',
  asyncHandler(async (req, res) => {
    const input = parse(crawlManySchema, req.body);
    res.status(201).json(await crawlMany(input.sourceIds, input.params));
  }),
);
