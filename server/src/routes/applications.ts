import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import { ALL_STATUSES } from '../domain/status.js';
import type { AppStatus } from '../domain/status.js';
import {
  createApplication,
  deleteApplication,
  getApplication,
  listApplications,
  transitionApplication,
  updateApplication,
} from '../services/applications.service.js';
import { addNote, listTimeline } from '../services/timeline.service.js';

const router = Router();

const STATUS_VALUES = ALL_STATUSES as [AppStatus, ...AppStatus[]];
const statusEnum = z.enum(STATUS_VALUES);

const applicationSchema = z.object({
  companyId: z.number().int().positive('请选择公司'),
  positionTitle: z.string().trim().min(1, '岗位名不能为空').max(200),
  jobType: z.enum(['school', 'intern']).optional(),
  channel: z.string().trim().max(50).nullable().optional(),
  jdUrl: z.string().trim().max(500).nullable().optional(),
  jdDescription: z.string().max(4000, 'JD 描述最多 4000 字').nullable().optional(),
  status: statusEnum.optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  deadline: z.string().trim().max(30).nullable().optional(),
  appliedAt: z.string().trim().max(30).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  resumeId: z.number().int().positive().nullable().optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query;
    const statuses = Array.isArray(q.status) ? (q.status as string[]) : typeof q.status === 'string' ? [q.status] : [];
    const parsed = listApplications({
      statuses: statuses.length > 0 ? (statuses as never[]) : undefined,
      companyId: q.companyId ? Number(q.companyId) : undefined,
      jobType: typeof q.jobType === 'string' ? q.jobType : undefined,
      priority: typeof q.priority === 'string' ? q.priority : undefined,
      keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
      sortBy: ['updatedAt', 'appliedAt', 'deadline'].includes(String(q.sortBy)) ? (q.sortBy as 'updatedAt') : undefined,
      sortOrder: q.sortOrder === 'asc' ? 'asc' : 'desc',
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 20,
    });
    res.json(parsed);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(applicationSchema, req.body);
    res.status(201).json(createApplication(input));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const application = getApplication(id);
    res.json({ ...application, timeline: listTimeline(id) });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(applicationSchema.partial(), req.body);
    res.json(updateApplication(parseId(req.params.id), input));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteApplication(parseId(req.params.id));
    res.status(204).end();
  }),
);

const transitionSchema = z.object({
  toStatus: statusEnum,
  note: z.string().max(1000).nullable().optional(),
  occurredAt: z.string().trim().max(30).optional(),
  reopen: z.boolean().optional(),
});

router.post(
  '/:id/transitions',
  asyncHandler(async (req, res) => {
    const input = parse(transitionSchema, req.body);
    res.status(201).json(transitionApplication(parseId(req.params.id), input));
  }),
);

const noteSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200),
  description: z.string().max(2000).nullable().optional(),
  occurredAt: z.string().trim().max(30).optional(),
});

router.post(
  '/:id/timeline',
  asyncHandler(async (req, res) => {
    const input = parse(noteSchema, req.body);
    res.status(201).json(addNote(parseId(req.params.id), input.title, input.description, input.occurredAt));
  }),
);

export default router;
