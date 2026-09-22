import { chromium, type Browser } from 'playwright';
import { AppError } from '../../middleware/error.js';
import { auditTimer } from '../audit.service.js';
import { getApplication } from '../applications.service.js';
import { getResume, type Resume } from '../resumes.service.js';

/**
 * 官网投递表单自动填表助手（实验性，M11 扩展）。
 * 合规边界：只做「打开投递页 + 识别并填充常见字段」，提交永远由用户人工完成；
 * 浏览器保持打开（headful），用户核对后自行点击提交。
 */

export interface FieldMapping {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  school?: string;
  major?: string;
  degree?: string;
}

/** 简历 → 表单字段映射（纯函数，便于单测） */
export function buildFieldMapping(resume: Resume): FieldMapping {
  const b = resume.basic ?? {};
  const edu = resume.education[0];
  return {
    name: b.name || undefined,
    email: b.email || undefined,
    phone: b.phone || undefined,
    city: b.city || undefined,
    school: edu?.school || undefined,
    major: edu?.major || undefined,
    degree: edu?.degree || undefined,
  };
}

const FIELD_PATTERNS: Array<{ key: keyof FieldMapping; patterns: RegExp[] }> = [
  { key: 'name', patterns: [/姓名/, /您的名字/, /真实姓名/, /\bname\b/i, /username/i] },
  { key: 'email', patterns: [/邮箱/, /邮件/, /email/i, /e-mail/i] },
  { key: 'phone', patterns: [/电话/, /手机/, /联系方式/, /phone/i, /mobile/i, /tel/i] },
  { key: 'city', patterns: [/城市/, /现居/, /所在地/] },
  { key: 'school', patterns: [/学校/, /院校/, /毕业院校/, /school/i, /university/i, /college/i] },
  { key: 'major', patterns: [/专业/, /major/i] },
  { key: 'degree', patterns: [/学历/, /学位/, /degree/i, /最高学历/] },
];

export interface AutofillSession {
  filledFields: string[];
  message: string;
}

const openSessions = new Set<Browser>();

/** 关闭所有实验性填表会话（测试/维护用） */
export function closeAutofillSessions(): void {
  for (const browser of [...openSessions]) {
    browser.close().catch(() => undefined);
  }
}

export async function launchAutofill(applicationId: number, targetUrl?: string): Promise<AutofillSession> {
  const app = getApplication(applicationId);
  const url = (targetUrl || app.jdUrl || '').trim();
  if (!url) throw AppError.validation('该投递记录没有链接：请填写目标投递页 URL 或先补充 JD 链接');
  const resume = app.resumeId ? getResume(app.resumeId) : null;
  if (!resume) throw AppError.validation('请先在投递详情「简历与 AI」卡片关联一份简历（自动填表需要简历基本信息）');

  const mapping = buildFieldMapping(resume);
  const timer = auditTimer({
    kind: 'autofill',
    target: url,
    detail: `自动填充投递表单（岗位：${app.positionTitle}；已填充字段将记录在审计中）`,
  });

  let browser: Browser;
  try {
    browser = await chromium.launch({
      // 本地桌面应用：默认 headful（用户需人工核对并提交）；测试环境可设 AUTOFILL_HEADLESS=1
      headless: process.env.AUTOFILL_HEADLESS === '1',
      slowMo: 60,
    });
    openSessions.add(browser);
    browser.on('disconnected', () => openSessions.delete(browser));

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const filled: string[] = [];
    const fields = page.locator('input:visible, textarea:visible');
    const count = Math.min(await fields.count(), 80);
    for (let i = 0; i < count; i++) {
      const el = fields.nth(i);
      const attrs = await el
        .evaluate((node) => {
          const n = node as HTMLInputElement;
          return { name: n.name || '', id: n.id || '', placeholder: n.placeholder || '', label: n.getAttribute('aria-label') || '' };
        })
        .catch(() => ({ name: '', id: '', placeholder: '', label: '' }));
      const haystack = `${attrs.name} ${attrs.id} ${attrs.placeholder} ${attrs.label}`;
      for (const { key, patterns } of FIELD_PATTERNS) {
        const value = mapping[key];
        if (!value) continue;
        if (patterns.some((p) => p.test(haystack))) {
          const existing = await el.inputValue().catch(() => '');
          if (!existing) {
            await el.fill(value).catch(() => undefined);
            filled.push(key);
          }
          break;
        }
      }
    }

    const uniqueFilled = [...new Set(filled)];
    timer.ok(`已尝试填充 ${uniqueFilled.length} 个字段（${uniqueFilled.join('、')}）`);
    return {
      filledFields: uniqueFilled,
      message: `浏览器已打开投递页并尝试填充 ${uniqueFilled.length} 个字段。请人工核对填写内容（不要直接信任自动填充），确认无误后自行点击提交；完成后回到应用点「已投递，标记状态」。`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    timer.fail(msg);
    throw AppError.badGateway(`自动填表失败：${msg}`);
  }
}
