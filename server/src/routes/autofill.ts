import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import { launchAutofill } from '../services/autofill/autofill.service.js';

/** POST /api/autofill —— 官网投递表单自动填表助手（实验性，人工确认提交） */
const router = Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        applicationId: z.number().int().positive(),
        targetUrl: z.string().trim().max(1000).optional(),
      }),
      req.body,
    );
    res.status(201).json(await launchAutofill(parseId(String(input.applicationId)), input.targetUrl));
  }),
);

export default router;
