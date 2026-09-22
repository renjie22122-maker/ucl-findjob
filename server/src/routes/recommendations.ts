import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import { enqueueRecommendationRun } from '../scheduler.js';
import {
  addManualRecommendation,
  buildLinkedInSearchPlan,
  createSearchProfile,
  deleteSearchProfile,
  getSearchProfile,
  importRecommendation,
  importRecommendationsBatch,
  listRecommendationRuns,
  listRecommendations,
  listSearchProfiles,
  updateRecommendationStatus,
  updateSearchProfile,
} from '../services/recommendations.service.js';

const router = Router();

const profileSchema = z
  .object({
    resumeId: z.number().int().positive(),
    name: z.string().trim().min(1, '画像名称不能为空').max(100),
    keywords: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
    cities: z.array(z.string().trim().min(1).max(80)).max(5).optional(),
    sourceIds: z.array(z.string().trim().min(1).max(50)).min(1).max(5).optional(),
    recruitType: z.enum(['school', 'intern']).optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    maxPages: z.number().int().min(1).max(10).optional(),
    frequency: z.enum(['manual', 'daily', 'weekly']).optional(),
    enabled: z.boolean().optional(),
    autoImport: z.boolean().optional(),
  })
  .strict();

router.get(
  '/profiles',
  asyncHandler(async (_req, res) => {
    res.json({ items: listSearchProfiles() });
  }),
);

router.post(
  '/profiles',
  asyncHandler(async (req, res) => {
    res.status(201).json(createSearchProfile(parse(profileSchema, req.body)));
  }),
);

router.get(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    res.json(getSearchProfile(parseId(req.params.id)));
  }),
);

router.put(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    res.json(updateSearchProfile(parseId(req.params.id), parse(profileSchema.partial(), req.body)));
  }),
);

router.delete(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    deleteSearchProfile(parseId(req.params.id));
    res.status(204).end();
  }),
);

router.post(
  '/profiles/:id/run',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    parse(z.object({}).strict(), req.body ?? {});
    getSearchProfile(id);
    res.status(201).json(await enqueueRecommendationRun(id));
  }),
);

router.get(
  '/profiles/:id/linkedin-plan',
  asyncHandler(async (req, res) => {
    res.json(buildLinkedInSearchPlan(parseId(req.params.id)));
  }),
);

const recommendationQuerySchema = z
  .object({
    profileId: z.coerce.number().int().positive().optional(),
    status: z.enum(['new', 'saved', 'dismissed', 'imported']).optional(),
    sourceId: z.string().trim().min(1).max(50).optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    keyword: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(listRecommendations(parse(recommendationQuerySchema, req.query)));
  }),
);

const manualSchema = z
  .object({
    profileId: z.number().int().positive(),
    sourceId: z.enum(['linkedin-manual', 'manual']).optional(),
    sourceKey: z.string().trim().min(1).max(300).optional(),
    companyName: z.string().trim().min(1, '公司名称不能为空').max(200),
    companyIndustry: z.string().trim().max(100).optional(),
    companyCity: z.string().trim().max(100).optional(),
    companyWebsite: z
      .string()
      .trim()
      .url()
      .max(1000)
      .refine((value) => /^https?:\/\//i.test(value), '仅支持 HTTP(S) 地址')
      .optional(),
    positionTitle: z.string().trim().min(1, '岗位名称不能为空').max(200),
    jobType: z.enum(['school', 'intern']).optional(),
    channel: z.string().trim().max(100).optional(),
    jdUrl: z
      .string()
      .trim()
      .url()
      .max(1000)
      .refine((value) => /^https?:\/\//i.test(value), '仅支持 HTTP(S) 地址')
      .optional(),
    deadline: z.string().trim().max(100).optional(),
    salary: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    jdDescription: z.string().trim().max(10_000).optional(),
  })
  .strict();

router.post(
  '/manual',
  asyncHandler(async (req, res) => {
    res.status(201).json(addManualRecommendation(parse(manualSchema, req.body)));
  }),
);

router.put(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ status: z.enum(['new', 'saved', 'dismissed']) }).strict(),
      req.body,
    );
    res.json(updateRecommendationStatus(parseId(req.params.id), input.status));
  }),
);

router.post(
  '/:id/import',
  asyncHandler(async (req, res) => {
    parse(z.object({}).strict(), req.body ?? {});
    res.status(201).json(importRecommendation(parseId(req.params.id)));
  }),
);

router.post(
  '/import-batch',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }).strict(),
      req.body,
    );
    res.status(201).json(importRecommendationsBatch(input.ids));
  }),
);

const runsQuerySchema = z
  .object({
    profileId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

router.get(
  '/runs',
  asyncHandler(async (req, res) => {
    res.json(listRecommendationRuns(parse(runsQuerySchema, req.query)));
  }),
);

export default router;
