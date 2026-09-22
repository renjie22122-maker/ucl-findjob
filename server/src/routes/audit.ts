import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { clearAudits, listAudits } from '../services/audit.service.js';

/** GET /api/audit —— 出站调用审计列表（分页 + 类型过滤） */
const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query;
    res.json(
      listAudits({
        kind: typeof q.kind === 'string' ? q.kind : undefined,
        page: q.page ? Number(q.page) : 1,
        pageSize: q.pageSize ? Number(q.pageSize) : 20,
      }),
    );
  }),
);

router.delete(
  '/',
  asyncHandler(async (_req, res) => {
    clearAudits();
    res.status(204).end();
  }),
);

export default router;
