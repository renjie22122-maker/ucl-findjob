import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse } from '../middleware/validate.js';
import { disconnectOauth2, pollDeviceCode, startDeviceCode } from '../services/oauth2/outlook.js';
import { getOauth2Token } from '../services/settings.service.js';

const router = Router();

const tenantSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => /^(common|organizations|consumers|[0-9a-fA-F-]{36})$/.test(v), '账户类型不正确');
const clientIdSchema = z.string().trim().min(10, 'Client ID 不能为空');

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const token = getOauth2Token();
    res.json({ configured: Boolean(token), user: token?.user ?? null });
  }),
);

router.post(
  '/start',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ tenant: tenantSchema.default('common'), clientId: clientIdSchema }),
      req.body,
    );
    res.status(201).json(await startDeviceCode(input.tenant, input.clientId));
  }),
);

router.post(
  '/poll',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        tenant: tenantSchema,
        clientId: clientIdSchema,
        deviceCode: z.string().min(5),
      }),
      req.body,
    );
    res.json(await pollDeviceCode(input.tenant, input.clientId, input.deviceCode));
  }),
);

router.post(
  '/disconnect',
  asyncHandler(async (_req, res) => {
    disconnectOauth2();
    res.json({ ok: true });
  }),
);

export default router;
