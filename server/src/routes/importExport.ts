import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/error.js';
import { parse } from '../middleware/validate.js';
import { STATUS_LABELS } from '../domain/status.js';
import type { AppStatus } from '../domain/status.js';
import { importRecords } from '../services/import.service.js';
import { listApplications } from '../services/applications.service.js';
import { parseExcelBuffer, exportToBuffer, buildTemplateWorkbook } from '../adapters/excel.adapter.js';
import { buildSnapshot, buildSnapshotHtml, publishSnapshot } from '../services/snapshot.service.js';
import * as XLSX from 'xlsx';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post(
  '/excel',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.validation('请上传 Excel 文件');
    try {
      const records = parseExcelBuffer(req.file.buffer);
      res.status(201).json(importRecords(records));
    } catch (err) {
      throw AppError.validation(err instanceof Error ? err.message : 'Excel 解析失败');
    }
  }),
);

const recordsSchema = z.object({
  records: z
    .array(
      z.object({
        companyName: z.string(),
        companyIndustry: z.string().optional(),
        companyCity: z.string().optional(),
        companyWebsite: z.string().optional(),
        positionTitle: z.string(),
        jobType: z.enum(['school', 'intern']).optional(),
        channel: z.string().optional(),
        jdUrl: z.string().optional(),
        appliedAt: z.string().optional(),
        deadline: z.string().optional(),
        status: z.string().optional(),
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
        note: z.string().optional(),
        salary: z.string().optional(),
        city: z.string().optional(),
        sourceKey: z.string().optional(),
        jdDescription: z.string().max(4000, 'JD 描述最多 4000 字').optional(),
      }),
    )
    .max(500, '单次最多导入 500 条'),
});

router.post(
  '/records',
  asyncHandler(async (req, res) => {
    const input = parse(recordsSchema, req.body);
    res.status(201).json(importRecords(input.records));
  }),
);

/** 按当前筛选条件导出（与列表查询参数一致） */
router.get(
  '/excel',
  asyncHandler(async (req, res) => {
    const q = req.query;
    const statuses = Array.isArray(q.status) ? (q.status as string[]) : typeof q.status === 'string' ? [q.status] : [];
    const filters = {
      statuses: statuses.length > 0 ? (statuses as AppStatus[]) : undefined,
      companyId: q.companyId ? Number(q.companyId) : undefined,
      jobType: typeof q.jobType === 'string' ? q.jobType : undefined,
      priority: typeof q.priority === 'string' ? q.priority : undefined,
      keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
    };

    // listApplications 单页最多返回 100 条；导出必须遍历所有分页，避免静默截断。
    const exportPageSize = 100;
    const firstPage = listApplications({ ...filters, page: 1, pageSize: exportPageSize });
    const items = [...firstPage.items];
    const pageCount = Math.ceil(firstPage.total / exportPageSize);
    for (let page = 2; page <= pageCount; page++) {
      items.push(...listApplications({ ...filters, page, pageSize: exportPageSize }).items);
    }

    const rows = items.map((a) => ({
      companyName: a.companyName ?? '',
      positionTitle: a.positionTitle,
      jobType: a.jobType,
      channel: a.channel,
      jdUrl: a.jdUrl,
      appliedAt: a.appliedAt,
      deadline: a.deadline,
      statusLabel: STATUS_LABELS[a.status],
      priority: a.priority,
      note: a.note,
    }));
    const buffer = exportToBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="findjob-export-${Date.now()}.xlsx"`);
    res.send(buffer);
  }),
);

router.get(
  '/template',
  asyncHandler(async (_req, res) => {
    const wb = buildTemplateWorkbook();
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="findjob-template.xlsx"');
    res.send(buffer);
  }),
);

// ---------- M10 快照导出 / GitHub Pages 发布 ----------
router.get(
  '/snapshot',
  asyncHandler(async (_req, res) => {
    const snapshot = buildSnapshot();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="findjob-snapshot.json"');
    res.send(JSON.stringify(snapshot, null, 2));
  }),
);

router.get(
  '/snapshot.html',
  asyncHandler(async (_req, res) => {
    const html = buildSnapshotHtml(buildSnapshot());
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="findjob-snapshot.html"');
    res.send(html);
  }),
);

router.post(
  '/publish',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ repoPath: z.string().trim().min(1, '请填写仓库路径'), message: z.string().max(200).optional() }),
      req.body,
    );
    res.json(await publishSnapshot(input.repoPath, input.message));
  }),
);

export default router;
