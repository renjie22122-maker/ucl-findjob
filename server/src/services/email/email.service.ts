import { getDb } from '../../db/connection.js';
import { AppError } from '../../middleware/error.js';
import { EMAIL_ANALYZE_MAX_DAYS } from '../../config.js';
import { EMAIL_EVENT_LABELS, EMAIL_EVENT_TO_REMINDER_TYPE } from '../../domain/status.js';
import type { EmailExtraction, EmailItem, Paginated, TimelineEvent, Reminder } from '../../domain/types.js';
import { nowIso } from '../../utils/time.js';
import { getEmailConfig } from '../settings.service.js';
import { fuzzyFindCompany } from '../companies.service.js';
import { extractWithLlm } from '../llm/llm.client.js';
import { extractWithRules } from '../llm/ruleBased.js';
import { fetchRecentEmails, testEmailConnection } from './imap.client.js';
import { isRecruitmentCandidate } from './filter.js';

interface EmailItemRow {
  id: number;
  message_id: string;
  subject: string;
  sender: string | null;
  received_at: string;
  snippet: string | null;
  extracted: string | null;
  status: string;
  application_id: number | null;
  created_at: string;
  applied_at: string | null;
}

function toItem(row: EmailItemRow): EmailItem {
  let extracted: EmailExtraction | null = null;
  if (row.extracted) {
    try {
      extracted = JSON.parse(row.extracted) as EmailExtraction;
    } catch {
      extracted = null;
    }
  }
  return {
    id: row.id,
    messageId: row.message_id,
    subject: row.subject,
    sender: row.sender,
    receivedAt: row.received_at,
    snippet: row.snippet,
    extracted,
    status: row.status as EmailItem['status'],
    applicationId: row.application_id,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

export interface AnalyzeResult {
  fetched: number;
  candidates: number;
  analyzed: number;
  skipped: number;
}

/** 拉取 + 初筛 + 去重 + 提取（LLM 优先，规则降级）→ 落库 pending */
export async function analyzeEmails(days: number): Promise<AnalyzeResult> {
  const cfg = getEmailConfig();
  if (!cfg) throw AppError.validation('请先在设置页配置邮箱');

  const clampedDays = Math.min(EMAIL_ANALYZE_MAX_DAYS, Math.max(1, days));
  const raws = await fetchRecentEmails(cfg, clampedDays);
  const candidates = raws.filter((r) => isRecruitmentCandidate(r.subject, r.sender));

  const db = getDb();
  const existing = new Set(
    (db.prepare('SELECT message_id FROM email_items').all() as { message_id: string }[]).map((r) => r.message_id),
  );

  let analyzed = 0;
  let skipped = 0;
  for (const raw of candidates) {
    if (existing.has(raw.messageId)) {
      skipped++;
      continue;
    }
    let extraction: EmailExtraction;
    try {
      extraction = await extractWithLlm(raw.subject, raw.sender, raw.snippet ?? '');
    } catch (err) {
      console.warn('[email] LLM 提取失败，降级本地规则：', err instanceof Error ? err.message : err);
      extraction = extractWithRules(raw.subject, raw.sender, raw.snippet ?? '');
    }
    db.prepare(
      `INSERT INTO email_items (message_id, subject, sender, received_at, snippet, extracted, status, application_id, created_at, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
    ).run(
      raw.messageId,
      raw.subject,
      raw.sender,
      raw.receivedAt,
      raw.snippet,
      JSON.stringify(extraction),
      nowIso(),
    );
    analyzed++;
  }

  return { fetched: raws.length, candidates: candidates.length, analyzed, skipped };
}

export function testEmail(): Promise<{ ok: boolean; message: string }> {
  const cfg = getEmailConfig();
  if (!cfg) throw AppError.validation('请先在设置页配置邮箱');
  return testEmailConnection(cfg);
}

export function listEmailItems(filters: { status?: string; page?: number; pageSize?: number } = {}): Paginated<EmailItem> {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM email_items ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM email_items ${where} ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as EmailItemRow[];
  return { items: rows.map(toItem), total, page, pageSize };
}

export function countPendingEmailItems(): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM email_items WHERE status = 'pending'").get() as { c: number }).c;
}

/** 应用提取结果：生成时间线笔记 + 未来时间提醒（ADR-7：不改状态机） */
export function applyEmailItem(
  id: number,
  extractedOverride?: EmailExtraction,
): { item: EmailItem; timelineEvent: TimelineEvent | null; reminder: Reminder | null; warning: string | null } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM email_items WHERE id = ?').get(id) as EmailItemRow | undefined;
  if (!row) throw AppError.notFound('邮件记录');
  if (row.status !== 'pending') throw AppError.conflict('该邮件已处理');

  let extracted: EmailExtraction | null;
  if (extractedOverride) {
    extracted = extractedOverride;
  } else {
    try {
      extracted = row.extracted ? (JSON.parse(row.extracted) as EmailExtraction) : null;
    } catch {
      extracted = null;
    }
  }

  let applicationId: number | null = null;
  let timelineEvent: TimelineEvent | null = null;
  let reminder: Reminder | null = null;
  let warning: string | null = null;

  if (extracted?.company) {
    const company = fuzzyFindCompany(extracted.company);
    if (!company) {
      warning = `未在库中找到公司「${extracted.company}」，本次仅记录邮件，可先在申请列表添加该公司后重新导入邮件。`;
    } else {
      // 按公司 + 岗位匹配申请，岗位缺失则取该公司最近更新的申请
      let appRow: { id: number } | undefined;
      if (extracted.positionTitle) {
        appRow = db
          .prepare(
            'SELECT id FROM applications WHERE company_id = ? AND position_title LIKE ? ORDER BY updated_at DESC LIMIT 1',
          )
          .get(company.id, `%${extracted.positionTitle}%`) as { id: number } | undefined;
      }
      if (!appRow) {
        appRow = db
          .prepare('SELECT id FROM applications WHERE company_id = ? ORDER BY updated_at DESC LIMIT 1')
          .get(company.id) as { id: number } | undefined;
      }
      applicationId = appRow?.id ?? null;
    }
  } else {
    warning = '未识别到公司信息，仅记录邮件内容。';
  }

  const now = nowIso();
  db.transaction(() => {
    if (applicationId && extracted) {
      const eventLabel = extracted.eventType ? EMAIL_EVENT_LABELS[extracted.eventType] : '邮件';
      const title = `邮件：${eventLabel}${extracted.positionTitle ? `（${extracted.positionTitle}）` : ''}`;
      const description = [extracted.summary, row.subject ? `主题：${row.subject}` : null].filter(Boolean).join('；');
      const ev = db
        .prepare(
          `INSERT INTO timeline_events (application_id, event_type, from_status, to_status, title, description, occurred_at, created_at)
           VALUES (?, 'note', NULL, NULL, ?, ?, ?, ?)`,
        )
        .run(applicationId, title, description || null, now, now);
      timelineEvent = {
        id: Number(ev.lastInsertRowid),
        applicationId,
        eventType: 'note',
        fromStatus: null,
        toStatus: null,
        title,
        description: description || null,
        occurredAt: now,
        createdAt: now,
      };

      if (extracted.eventTime && extracted.eventTime > now && extracted.eventType) {
        const remType = EMAIL_EVENT_TO_REMINDER_TYPE[extracted.eventType] ?? 'other';
        // 提醒去重：同申请 + 同类型 + 同时间且未完成的提醒不重复创建
        const existingRem = db
          .prepare(
            'SELECT id FROM reminders WHERE application_id = ? AND type = ? AND scheduled_at = ? AND done = 0',
          )
          .get(applicationId, remType, extracted.eventTime) as { id: number } | undefined;
        if (existingRem) {
          warning = warning ? `${warning}（提醒已存在，未重复创建）` : '提醒已存在，未重复创建';
        } else {
          const rem = db
            .prepare(
              `INSERT INTO reminders (application_id, type, title, scheduled_at, done, done_at, created_at)
               VALUES (?, ?, ?, ?, 0, NULL, ?)`,
            )
            .run(applicationId, remType, title, extracted.eventTime, now);
          reminder = {
            id: Number(rem.lastInsertRowid),
            applicationId,
            type: remType as Reminder['type'],
            title,
            scheduledAt: extracted.eventTime,
            done: 0,
            doneAt: null,
            createdAt: now,
          };
        }
      }
    }
    db.prepare(
      "UPDATE email_items SET extracted = ?, status = 'confirmed', application_id = ?, applied_at = ? WHERE id = ?",
    ).run(JSON.stringify(extracted), applicationId, now, id);
  })();

  const updated = db.prepare('SELECT * FROM email_items WHERE id = ?').get(id) as EmailItemRow;
  return { item: toItem(updated), timelineEvent, reminder, warning };
}

export function dismissEmailItem(id: number): EmailItem {
  const db = getDb();
  const row = db.prepare('SELECT id, status FROM email_items WHERE id = ?').get(id) as { id: number; status: string } | undefined;
  if (!row) throw AppError.notFound('邮件记录');
  if (row.status !== 'pending') throw AppError.conflict('该邮件已处理');
  db.prepare("UPDATE email_items SET status = 'dismissed' WHERE id = ?").run(id);
  const updated = db.prepare('SELECT * FROM email_items WHERE id = ?').get(id) as EmailItemRow;
  return toItem(updated);
}

export interface ApplyBatchResult {
  applied: number;
  skipped: number;
  results: Array<{ id: number; ok: boolean; message: string }>;
}

/** 批量应用高置信度提取结果（≥ minConfidence），逐条容错（文档 01 F16） */
export function applyEmailBatch(minConfidence = 0.8): ApplyBatchResult {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, extracted FROM email_items WHERE status = 'pending' ORDER BY received_at DESC")
    .all() as { id: number; extracted: string | null }[];

  const results: ApplyBatchResult['results'] = [];
  let applied = 0;
  let skipped = 0;

  for (const row of rows) {
    let extraction: EmailExtraction | null = null;
    try {
      extraction = row.extracted ? (JSON.parse(row.extracted) as EmailExtraction) : null;
    } catch {
      extraction = null;
    }
    if (!extraction || extraction.confidence < minConfidence) {
      skipped++;
      continue;
    }
    try {
      const r = applyEmailItem(row.id);
      applied++;
      results.push({
        id: row.id,
        ok: true,
        message: r.timelineEvent
          ? `已生成时间线笔记${r.reminder ? '与提醒' : ''}${r.warning ? `（${r.warning}）` : ''}`
          : r.warning ?? '已应用',
      });
    } catch (err) {
      results.push({ id: row.id, ok: false, message: err instanceof Error ? err.message : '应用失败' });
    }
  }

  return { applied, skipped, results };
}
