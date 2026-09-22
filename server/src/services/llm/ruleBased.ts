import type { EmailExtraction } from '../../domain/types.js';
import type { EmailEventType } from '../../domain/status.js';

const RULES: Array<{ pattern: RegExp; type: EmailEventType }> = [
  { pattern: /offer|录用|录取|发放意向/i, type: 'offer' },
  { pattern: /感谢信|遗憾|暂不合适|未能通过|没有通过|不匹配/i, type: 'reject' },
  { pattern: /笔试|在线考试|机考/i, type: 'written_test' },
  { pattern: /测评|在线评估|性格测试|认知能力/i, type: 'assessment' },
  { pattern: /面试|面谈/i, type: 'interview' },
];

function detectEventType(text: string): EmailEventType | null {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return null;
}

/** 从【公司】/「公司」形式或发件人名称提取公司 */
function detectCompany(subject: string, sender: string): string | null {
  const bracket = subject.match(/[【\[「]([^】\]」]{2,30})[】\]」]/);
  if (bracket) return bracket[1].trim();
  const senderName = sender.split('<')[0]?.trim();
  if (senderName) return senderName.replace(/\s*(校招|招聘|人才|HR|人事).*$/i, '').slice(0, 30);
  return null;
}

function detectEventTime(text: string): string | null {
  const m = text.match(
    /(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})日?(?:[^\d]{0,6}(\d{1,2})[:：点时](\d{1,2})分?)?/,
  );
  if (!m) return null;
  const year = m[1];
  const month = m[2].padStart(2, '0');
  const day = m[3].padStart(2, '0');
  const hour = m[4] ? m[4].padStart(2, '0') : '00';
  const minute = m[5] ? m[5].padStart(2, '0') : '00';
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** 本地规则降级提取（ADR-7），置信度封顶 0.5 */
export function extractWithRules(subject: string, sender: string, snippet: string): EmailExtraction {
  const text = `${subject} ${snippet}`;
  const eventType = detectEventType(text);
  const company = detectCompany(subject, sender);
  const eventTime = detectEventTime(text);
  const summary = eventType ? `本地规则识别：${eventType}` : '本地规则识别：招聘相关邮件';
  const confidence = eventType ? 0.4 : 0.2;

  return { company, eventType, eventTime, positionTitle: null, summary, confidence };
}
