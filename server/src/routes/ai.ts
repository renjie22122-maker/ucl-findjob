import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse } from '../middleware/validate.js';
import { getApplication } from '../services/applications.service.js';
import { getResume } from '../services/resumes.service.js';
import {
  buildActionList,
  compareOffers,
  generateCoverLetter,
  generateInterviewQuestions,
  matchAllApplications,
  matchResume,
  matchResumeBatch,
  parseInterviewRecord,
  polishResume,
  reviewResume,
} from '../services/ai.service.js';

const router = Router();

/** POST /api/ai/review —— 简历审查 */
router.post(
  '/review',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ resumeId: z.number().int().positive() }), req.body);
    res.json(await reviewResume(getResume(input.resumeId)));
  }),
);

/** POST /api/ai/match —— 简历 ↔ 岗位匹配打分（含 JD 全文） */
router.post(
  '/match',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ resumeId: z.number().int().positive(), applicationId: z.number().int().positive() }),
      req.body,
    );
    const app = getApplication(input.applicationId);
    res.json(await matchResume(getResume(input.resumeId), app.positionTitle, app.companyName, app.jdDescription));
  }),
);

/** POST /api/ai/match-batch —— 抓取结果批量匹配排序 */
router.post(
  '/match-batch',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        resumeId: z.number().int().positive(),
        items: z
          .array(
            z.object({
              sourceKey: z.string().optional(),
              companyName: z.string(),
              positionTitle: z.string(),
              jdDescription: z.string().nullable().optional(),
              city: z.string().max(100).nullable().optional(),
            }),
          )
          .max(50, '单次最多匹配 50 条'),
      }),
      req.body,
    );
    res.json(await matchResumeBatch(getResume(input.resumeId), input.items));
  }),
);

/** POST /api/ai/match-all —— 全量岗位结构化匹配（学历/技能/城市，秒级，无需 LLM） */
router.post(
  '/match-all',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ resumeId: z.number().int().positive() }), req.body);
    res.json({ items: matchAllApplications(getResume(input.resumeId)) });
  }),
);

/** POST /api/ai/cover-letter —— 岗位定制求职信 */
router.post(
  '/cover-letter',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ resumeId: z.number().int().positive(), applicationId: z.number().int().positive() }),
      req.body,
    );
    const app = getApplication(input.applicationId);
    res.json({
      content: await generateCoverLetter(getResume(input.resumeId), app.positionTitle, app.companyName),
    });
  }),
);

/** POST /api/ai/interview-questions —— 岗位定制面试题 */
router.post(
  '/interview-questions',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ resumeId: z.number().int().positive(), applicationId: z.number().int().positive() }),
      req.body,
    );
    const app = getApplication(input.applicationId);
    res.json(
      await generateInterviewQuestions(
        getResume(input.resumeId),
        app.positionTitle,
        app.companyName,
        app.jdDescription,
      ),
    );
  }),
);

/** POST /api/ai/polish —— 简历润色（STAR + ATS） */
router.post(
  '/polish',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ resumeId: z.number().int().positive(), jobTitle: z.string().max(100).optional() }),
      req.body,
    );
    res.json(await polishResume(getResume(input.resumeId), input.jobTitle));
  }),
);

/** POST /api/ai/parse-interview —— 面试记录自然语言解析 */
router.post(
  '/parse-interview',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ text: z.string().min(10).max(5000) }), req.body);
    res.json(await parseInterviewRecord(input.text));
  }),
);

/** POST /api/ai/compare-offers —— Offer 对比 */
router.post(
  '/compare-offers',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        applicationIds: z.array(z.number().int().positive()).min(2, '至少选择 2 个 Offer').max(3, '最多对比 3 个'),
      }),
      req.body,
    );
    const items = input.applicationIds.map((id) => {
      const app = getApplication(id);
      return { company: app.companyName ?? '未知公司', positionTitle: app.positionTitle, note: app.note };
    });
    res.json(await compareOffers(items));
  }),
);

/** POST /api/ai/action-list —— 本周投递清单（匹配度 × 紧急度） */
router.post(
  '/action-list',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ resumeId: z.number().int().positive(), topN: z.number().int().min(1).max(50).optional() }),
      req.body,
    );
    res.json({ items: buildActionList(getResume(input.resumeId), input.topN ?? 20) });
  }),
);

export default router;
