import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import { EMAIL_EVENT_TYPES } from '../domain/status.js';
import { analyzeEmails, applyEmailBatch, applyEmailItem, dismissEmailItem, listEmailItems } from '../services/email/email.service.js';

const router = Router();

router.post(
  '/analyze',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ days: z.number().int().min(1).max(30).optional() }), req.body ?? {});
    res.status(201).json(await analyzeEmails(input.days ?? 14));
  }),
);

router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const q = req.query;
    res.json(
      listEmailItems({
        status: typeof q.status === 'string' ? q.status : undefined,
        page: q.page ? Number(q.page) : 1,
        pageSize: q.pageSize ? Number(q.pageSize) : 20,
      }),
    );
  }),
);

const extractedSchema = z.object({
  company: z.string().nullable(),
  eventType: z.enum(EMAIL_EVENT_TYPES).nullable(),
  eventTime: z.string().nullable(),
  positionTitle: z.string().nullable(),
  summary: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

router.post(
  '/items/:id/apply',
  asyncHandler(async (req, res) => {
    const override = req.body?.extracted ? parse(extractedSchema, req.body.extracted) : undefined;
    res.status(201).json(applyEmailItem(parseId(req.params.id), override));
  }),
);

router.post(
  '/items/:id/dismiss',
  asyncHandler(async (req, res) => {
    res.json(dismissEmailItem(parseId(req.params.id)));
  }),
);

router.post(
  '/apply-batch',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ minConfidence: z.number().min(0).max(1).optional() }), req.body ?? {});
    res.status(201).json(applyEmailBatch(input.minConfidence ?? 0.8));
  }),
);

export default router;
