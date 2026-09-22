import { getDb } from '../db/connection.js';
import { nowIso } from '../utils/time.js';

/**
 * 出站调用审计（本地日志）：记录每一次爬虫/IMAP/LLM/OAuth2/JD 解析的外部调用
 * 时间、目标、发送内容摘要（脱敏）、结果与耗时，让数据流出有据可查。
 */

export const AUDIT_KINDS = ['crawl', 'imap', 'llm', 'oauth2', 'jd-parse', 'github', 'ai', 'publish', 'autofill'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export interface AuditEntry {
  kind: AuditKind;
  target: string;
  detail?: string;
  status: 'success' | 'failed';
  result?: string;
  error?: string;
  durationMs?: number;
}

interface AuditRow {
  id: number;
  kind: string;
  target: string;
  detail: string | null;
  status: string;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
}

const MAX_ROWS = 2000;

/** 记录一条审计日志（自动裁剪保留最近 MAX_ROWS 条） */
export function recordAudit(entry: AuditEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (kind, target, detail, status, result, error, duration_ms, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.kind,
    entry.target.slice(0, 500),
    entry.detail?.slice(0, 1000) ?? null,
    entry.status,
    entry.result?.slice(0, 500) ?? null,
    entry.error?.slice(0, 1000) ?? null,
    entry.durationMs ?? null,
    nowIso(),
  );
  const count = (db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c;
  if (count > MAX_ROWS) {
    db.prepare(
      `DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?)`,
    ).run(MAX_ROWS);
  }
}

export function listAudits(filters: { kind?: string; page?: number; pageSize?: number } = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.kind) {
    conditions.push('kind = ?');
    params.push(filters.kind);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as AuditRow[];
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind as AuditKind,
      target: r.target,
      detail: r.detail,
      status: r.status as 'success' | 'failed',
      result: r.result,
      error: r.error,
      durationMs: r.duration_ms,
      startedAt: r.started_at,
    })),
    total,
    page,
    pageSize,
  };
}

export function clearAudits(): void {
  getDb().prepare('DELETE FROM audit_logs').run();
}

/** 计时辅助：返回记录函数 */
export function auditTimer(entry: Omit<AuditEntry, 'status' | 'durationMs'>): {
  ok: (result?: string) => void;
  fail: (error: string) => void;
} {
  const start = Date.now();
  return {
    ok: (result) => {
      recordAudit({ ...entry, status: 'success', result, durationMs: Date.now() - start });
    },
    fail: (error) => {
      recordAudit({ ...entry, status: 'failed', error, durationMs: Date.now() - start });
    },
  };
}
