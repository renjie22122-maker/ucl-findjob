import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import {
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  updateCompany,
} from '../services/companies.service.js';

const router = Router();

const companySchema = z.object({
  name: z.string().trim().min(1, '公司名不能为空').max(100),
  industry: z.string().trim().max(50).nullable().optional(),
  city: z.string().trim().max(50).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : undefined;
    res.json({ items: listCompanies(keyword) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(companySchema, req.body);
    res.status(201).json(createCompany(input));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(getCompany(parseId(req.params.id)));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(companySchema, req.body);
    res.json(updateCompany(parseId(req.params.id), input));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteCompany(parseId(req.params.id));
    res.status(204).end();
  }),
);

export default router;
