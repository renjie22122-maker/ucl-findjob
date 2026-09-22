import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { getOverview, getTrends } from '../services/stats.service.js';
import { getToday } from '../services/today.service.js';
import { countPendingEmailItems } from '../services/email/email.service.js';

const router = Router();

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const stats = getOverview();
    res.json({ ...stats, pendingEmails: countPendingEmailItems() });
  }),
);

router.get(
  '/trends',
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days ?? 30);
    res.json({ items: getTrends(Number.isFinite(days) ? days : 30) });
  }),
);

router.get(
  '/today',
  asyncHandler(async (_req, res) => {
    res.json(getToday());
  }),
);

export default router;
