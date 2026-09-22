import { Router } from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import {
  buildResumeHtml,
  createResume,
  deleteResume,
  fetchGithubProfile,
  getResume,
  listResumes,
  updateResume,
} from '../services/resumes.service.js';
import { generateResume, parseCertificateImage, parseResumeText } from '../services/ai.service.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const resumeSchema = z.object({
  name: z.string().trim().min(1, '简历名称不能为空').max(100),
  targetRole: z.string().trim().max(100).nullable().optional(),
  basic: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      city: z.string().optional(),
      github: z.string().optional(),
      blog: z.string().optional(),
      summary: z.string().optional(),
    })
    .nullable()
    .optional(),
  education: z
    .array(
      z.object({
        school: z.string(),
        degree: z.string().optional(),
        major: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        gpa: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  experience: z
    .array(
      z.object({
        company: z.string(),
        role: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        description: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  projects: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().optional(),
        link: z.string().optional(),
        tech: z.array(z.string()).default([]),
        description: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  skills: z.array(z.string()).optional(),
  content: z.string().nullable().optional(),
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: listResumes() });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(resumeSchema, req.body);
    res.status(201).json(createResume(input));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(getResume(parseId(req.params.id)));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(resumeSchema.partial(), req.body);
    res.json(updateResume(parseId(req.params.id), input));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteResume(parseId(req.params.id));
    res.status(204).end();
  }),
);

/** 粘贴文本 → AI 解析结构化简历 */
router.post(
  '/parse-text',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ text: z.string().min(20, '文本太短').max(20000) }), req.body);
    res.json(await parseResumeText(input.text));
  }),
);

/** PDF 简历上传 → 提取文本 → AI 解析结构化（借鉴 Career-Search：上传 PDF 出画像） */
router.post(
  '/parse-pdf',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.validation('请上传 PDF 文件');
    let text = '';
    try {
      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      text = result.text ?? '';
      await parser.destroy().catch(() => undefined);
    } catch {
      throw AppError.validation('PDF 解析失败：文件可能已加密或是扫描件（图片型 PDF 请用证书识别或粘贴文本）');
    }
    if (text.trim().length < 20) throw AppError.validation('未能从 PDF 提取文本（可能是扫描件，请改用粘贴文本或证书识别）');
    try {
      const structured = await parseResumeText(text.slice(0, 12000));
      res.json({ structured, text: text.slice(0, 12000) });
    } catch {
      // LLM 未配置：返回原文让前端放入粘贴框
      res.json({ structured: null, text: text.slice(0, 12000), warning: '未配置 LLM，已提取 PDF 原文，请使用「AI 解析填充」完成结构化' });
    }
  }),
);

/** GitHub 主页导入 */
router.post(
  '/import-github',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ username: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9-]+$/, 'GitHub 用户名格式不正确') }),
      req.body,
    );
    res.json(await fetchGithubProfile(input.username));
  }),
);

/** 学位证/毕业证图片识别（需视觉模型） */
router.post(
  '/parse-certificate',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        imageBase64: z.string().min(20),
        mimeType: z.string().default('image/jpeg'),
        certType: z.enum(['degree', 'diploma', 'other']).default('other'),
      }),
      req.body,
    );
    res.json(await parseCertificateImage(input.imageBase64, input.mimeType, input.certType));
  }),
);

/** AI 生成/按岗位微调简历，结果存回 content */
router.post(
  '/:id/generate',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const input = parse(
      z.object({ jobTitle: z.string().trim().max(100).optional(), company: z.string().trim().max(100).optional() }),
      req.body ?? {},
    );
    const resume = getResume(id);
    const content = await generateResume(resume, input.jobTitle, input.company);
    updateResume(id, { content });
    res.json({ content });
  }),
);

/** HTML 简历导出（浏览器打开后可打印为 PDF） */
router.get(
  '/:id/export.html',
  asyncHandler(async (req, res) => {
    const resume = getResume(parseId(req.params.id));
    const html = buildResumeHtml(resume);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resume-${resume.id}.html"`);
    res.send(html);
  }),
);

export default router;
