import { z } from 'zod';
import { EMAIL_EVENT_TYPES } from '../../domain/status.js';
import type { EmailExtraction } from '../../domain/types.js';
import { getLlmConfig } from '../settings.service.js';
import { auditTimer } from '../audit.service.js';
import type { AuditKind } from '../audit.service.js';
import { AppError } from '../../middleware/error.js';

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  auditKind?: AuditKind;
  auditDetail?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

/**
 * 通用 OpenAI 兼容对话调用（DeepSeek 默认；可配置其他兼容端点）。
 * 记录出站审计；未配置 Key 抛错由调用方决定降级策略。
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const cfg = getLlmConfig();
  if (!cfg?.apiKey) {
    throw AppError.validation('未配置 LLM API Key，请在设置页配置（DeepSeek 等 OpenAI 兼容接口；部分功能支持本地规则降级）');
  }

  const timer = auditTimer({
    kind: opts.auditKind ?? 'ai',
    target: `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions（模型 ${cfg.model}）`,
    detail: opts.auditDetail ?? '通用 AI 对话',
  });

  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2000,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const message = `AI 调用失败 HTTP ${res.status}：${body.slice(0, 200)}`;
      timer.fail(message);
      throw new Error(message);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      timer.fail('AI 返回为空');
      throw new Error('AI 返回为空');
    }
    timer.ok(`返回 ${content.length} 字符`);
    return content;
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('AI 调用失败') && err.message !== 'AI 返回为空') {
      timer.fail(err.message);
    }
    throw err;
  }
}

/** JSON 模式对话：要求模型输出纯 JSON 并用 zod 校验 */
export async function chatJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  opts: ChatOptions = {},
): Promise<T> {
  const content = await chatCompletion(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { ...opts, jsonMode: true },
  );
  // 容错：剥离可能的代码块围栏
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return schema.parse(JSON.parse(cleaned));
}

/** 文本模式对话（生成简历/求职信等） */
export async function chatText(
  system: string,
  user: string,
  opts: ChatOptions = {},
): Promise<string> {
  return chatCompletion(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    opts,
  );
}

/** 视觉模式（学位证/毕业证图片识别）：需配置支持图片输入的模型（如 qwen-vl-max/GLM-4V） */
export async function chatVision(
  system: string,
  userText: string,
  imageBase64: string,
  mimeType: string,
  opts: ChatOptions = {},
): Promise<string> {
  return chatCompletion(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      },
    ],
    opts,
  );
}

const extractionSchema = z.object({
  company: z.string().nullable(),
  eventType: z.enum(EMAIL_EVENT_TYPES).nullable(),
  eventTime: z.string().nullable(),
  positionTitle: z.string().nullable(),
  summary: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const EXTRACT_SYSTEM_PROMPT = `你是招聘邮件信息提取助手。从给定的求职相关邮件中提取结构化信息，只输出 JSON，不要输出其他内容。
JSON 格式：
{
  "company": "公司名称，无法判断则为 null",
  "eventType": "written_test | interview | assessment | offer | reject | other | null",
  "eventTime": "邮件提到的笔试/面试/截止时间，格式 YYYY-MM-DDTHH:mm:ss，无法判断则为 null",
  "positionTitle": "应聘岗位名称，无法判断则为 null",
  "summary": "一句话中文摘要",
  "confidence": 0 到 1 的置信度
}
规则：eventType 中 written_test=笔试通知, interview=面试邀请, assessment=在线测评, offer=录用/offer, reject=感谢信/拒绝, other=其他招聘相关；时间缺失或已过期则 eventTime 为 null。`;

function isValidTime(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : value;
}

/** DeepSeek（OpenAI 兼容）结构化提取；失败抛错由调用方降级；记录出站审计 */
export async function extractWithLlm(
  subject: string,
  sender: string,
  snippet: string,
): Promise<EmailExtraction> {
  const userContent = `主题：${subject}\n发件人：${sender}\n正文摘要：\n${snippet}`;
  const parsed = await chatJson(EXTRACT_SYSTEM_PROMPT, userContent, extractionSchema, {
    temperature: 0.1,
    maxTokens: 500,
    auditKind: 'llm',
    auditDetail: `发送招聘候选邮件「主题 + 正文摘要(≤300字)」做结构化提取；主题：${subject.slice(0, 50)}`,
  });
  return {
    company: parsed.company,
    eventType: parsed.eventType,
    eventTime: isValidTime(parsed.eventTime),
    positionTitle: parsed.positionTitle,
    summary: parsed.summary,
    confidence: parsed.confidence,
  };
}

/** 测试 LLM 连通性（最小请求），记录出站审计 */
export async function testLlm(): Promise<{ ok: boolean; message: string }> {
  const cfg = getLlmConfig();
  if (!cfg?.apiKey) return { ok: false, message: '未配置 API Key' };
  const timer = auditTimer({
    kind: 'llm',
    target: `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions（模型 ${cfg.model}）`,
    detail: '测试连通（发送固定文本「请回复：OK」）',
  });
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: '请回复：OK' }],
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      timer.fail(`HTTP ${res.status}`);
      return { ok: false, message: `调用失败 HTTP ${res.status}` };
    }
    timer.ok('连通正常');
    return { ok: true, message: '连通正常' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    timer.fail(message);
    return { ok: false, message: `连接失败：${message}` };
  }
}
