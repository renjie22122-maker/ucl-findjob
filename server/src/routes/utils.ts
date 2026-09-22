import { Router } from 'express';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/error.js';
import { parse } from '../middleware/validate.js';
import { auditTimer } from '../services/audit.service.js';
import { fetchPublicHtml } from '../utils/safeFetch.js';

const router = Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, service: 'findjob-server', time: new Date().toISOString() });
  }),
);

const jdSchema = z.object({ url: z.string().trim().url('链接格式不正确') });

/** 解析官网 JD 链接：抓取标题与描述预填表单（文档 06 §7），记录出站审计 */
router.post(
  '/utils/parse-jd',
  asyncHandler(async (req, res) => {
    const { url } = parse(jdSchema, req.body);
    const timer = auditTimer({ kind: 'jd-parse', target: url, detail: '解析官网职位页标题与描述' });
    try {
      const { html } = await fetchPublicHtml(url);
      const $ = cheerio.load(html);
      const title = ($('title').first().text() || '').trim();
      const description = ($('meta[name="description"]').attr('content') || '').trim();
      // 公司提示：标题中第一个分隔符前的部分
      const sepMatch = title.match(/^([^|_\-–—]+)/);
      timer.ok(title ? `解析到标题「${title.slice(0, 40)}」` : '页面无标题');
      res.json({
        title,
        companyHint: sepMatch?.[1]?.trim() ?? null,
        description,
        ok: Boolean(title),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      timer.fail(message);
      if (err instanceof AppError) throw err;
      throw AppError.badGateway(`页面解析失败：${message}`);
    }
  }),
);

export default router;
