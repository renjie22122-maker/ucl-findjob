import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error.js';
import { canTransition, STATUS, STATUS_LABELS, TERMINAL_STATUSES } from '../domain/status.js';
import type { AppStatus } from '../domain/status.js';
import type { Application, Paginated, TimelineEvent } from '../domain/types.js';
import { nowIso } from '../utils/time.js';

interface ApplicationRow {
  id: number;
  company_id: number;
  company_name: string | null;
  position_title: string;
  job_type: string;
  channel: string | null;
  jd_url: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  applied_at: string | null;
  note: string | null;
  resume_id: number | null;
  jd_description: string | null;
  created_at: string;
  updated_at: string;
}

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name ?? undefined,
    positionTitle: row.position_title,
    jobType: row.job_type as Application['jobType'],
    channel: row.channel,
    jdUrl: row.jd_url,
    status: row.status as AppStatus,
    priority: row.priority as Application['priority'],
    deadline: row.deadline,
    appliedAt: row.applied_at,
    note: row.note,
    resumeId: row.resume_id,
    jdDescription: row.jd_description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT a.*, c.name AS company_name
  FROM applications a
  JOIN companies c ON c.id = a.company_id
`;

export interface ApplicationInput {
  companyId: number;
  positionTitle: string;
  jobType?: 'school' | 'intern';
  channel?: string | null;
  jdUrl?: string | null;
  status?: AppStatus;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  deadline?: string | null;
  appliedAt?: string | null;
  note?: string | null;
  resumeId?: number | null;
  jdDescription?: string | null;
}

export interface ApplicationFilters {
  statuses?: AppStatus[];
  companyId?: number;
  jobType?: string;
  priority?: string;
  keyword?: string;
  sortBy?: 'updatedAt' | 'appliedAt' | 'deadline';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export function listApplications(filters: ApplicationFilters = {}): Paginated<Application> {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(`a.status IN (${filters.statuses.map(() => '?').join(',')})`);
    params.push(...filters.statuses);
  }
  if (filters.companyId) {
    conditions.push('a.company_id = ?');
    params.push(filters.companyId);
  }
  if (filters.jobType) {
    conditions.push('a.job_type = ?');
    params.push(filters.jobType);
  }
  if (filters.priority) {
    conditions.push('a.priority = ?');
    params.push(filters.priority);
  }
  if (filters.keyword) {
    conditions.push('(a.position_title LIKE ? OR c.name LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortColumn =
    filters.sortBy === 'appliedAt' ? 'a.applied_at' : filters.sortBy === 'deadline' ? 'a.deadline' : 'a.updated_at';
  const sortOrder = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM applications a JOIN companies c ON c.id = a.company_id ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`${BASE_SELECT} ${where} ORDER BY ${sortColumn} ${sortOrder} NULLS LAST LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as ApplicationRow[];

  return { items: rows.map(toApplication), total, page, pageSize };
}

export function getApplication(id: number): Application {
  const row = getDb().prepare(`${BASE_SELECT} WHERE a.id = ?`).get(id) as ApplicationRow | undefined;
  if (!row) throw AppError.notFound('申请');
  return toApplication(row);
}

/** 创建申请：生成「创建记录」笔记事件；初始状态非 WISHLIST 时补状态事件（保证统计口径一致） */
export function createApplication(input: ApplicationInput): Application {
  const db = getDb();
  const now = nowIso();
  const initialStatus: AppStatus = input.status ?? STATUS.WISHLIST;

  // 三路数据源一致性：与 ImportService 同口径，按「公司+岗位」去重（手动录入也不能重复创建）
  const existing = db
    .prepare('SELECT id FROM applications WHERE company_id = ? AND position_title = ?')
    .get(input.companyId, input.positionTitle) as { id: number } | undefined;
  if (existing) {
    throw AppError.conflict(
      `该公司已存在岗位「${input.positionTitle}」的投递记录（#${existing.id}），无需重复创建：可在列表中直接推进状态或编辑该记录`,
    );
  }

  const info = db
    .prepare(
      `INSERT INTO applications
       (company_id, position_title, job_type, channel, jd_url, status, priority, deadline, applied_at, note, resume_id, jd_description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.companyId,
      input.positionTitle,
      input.jobType ?? 'school',
      input.channel ?? null,
      input.jdUrl ?? null,
      initialStatus,
      input.priority ?? 'MEDIUM',
      input.deadline ?? null,
      input.appliedAt ?? null,
      input.note ?? null,
      input.resumeId ?? null,
      input.jdDescription ?? null,
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);

  db.prepare(
    `INSERT INTO timeline_events (application_id, event_type, from_status, to_status, title, description, occurred_at, created_at)
     VALUES (?, 'note', NULL, NULL, ?, ?, ?, ?)`,
  ).run(id, '创建投递记录', null, now, now);

  if (initialStatus !== STATUS.WISHLIST) {
    db.prepare(
      `INSERT INTO timeline_events (application_id, event_type, from_status, to_status, title, description, occurred_at, created_at)
       VALUES (?, 'status_change', ?, ?, ?, ?, ?, ?)`,
    ).run(id, STATUS.WISHLIST, initialStatus, `状态更新：${STATUS_LABELS.WISHLIST} → ${STATUS_LABELS[initialStatus]}`, null, now, now);
  }

  return getApplication(id);
}

export function updateApplication(id: number, input: Partial<ApplicationInput>): Application {
  const db = getDb();
  const current = db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as ApplicationRow | undefined;
  if (!current) throw AppError.notFound('申请');

  // 状态变更只允许走 transitions 接口，PUT 不修改 status（ADR-1）
  const companyId = input.companyId ?? current.company_id;
  const positionTitle = input.positionTitle ?? current.position_title;
  const duplicate = db
    .prepare('SELECT id FROM applications WHERE company_id = ? AND position_title = ? AND id != ?')
    .get(companyId, positionTitle, id) as { id: number } | undefined;
  if (duplicate) {
    throw AppError.conflict(
      `该公司已存在岗位「${positionTitle}」的投递记录（#${duplicate.id}），无法将当前记录修改为重复项`,
    );
  }

  db.prepare(
    `UPDATE applications SET
       company_id = ?, position_title = ?, job_type = ?, channel = ?, jd_url = ?,
       priority = ?, deadline = ?, applied_at = ?, note = ?,
       resume_id = ?, jd_description = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    companyId,
    positionTitle,
    input.jobType ?? current.job_type,
    input.channel === undefined ? current.channel : input.channel,
    input.jdUrl === undefined ? current.jd_url : input.jdUrl,
    input.priority ?? current.priority,
    input.deadline === undefined ? current.deadline : input.deadline,
    input.appliedAt === undefined ? current.applied_at : input.appliedAt,
    input.note === undefined ? current.note : input.note,
    input.resumeId === undefined ? current.resume_id : input.resumeId,
    input.jdDescription === undefined ? current.jd_description : input.jdDescription,
    nowIso(),
    id,
  );
  return getApplication(id);
}

export function deleteApplication(id: number): void {
  const db = getDb();
  const row = db.prepare('SELECT id FROM applications WHERE id = ?').get(id);
  if (!row) throw AppError.notFound('申请');
  db.prepare('DELETE FROM applications WHERE id = ?').run(id);
}

export interface TransitionInput {
  toStatus: AppStatus;
  note?: string | null;
  occurredAt?: string;
  reopen?: boolean;
}

/** 状态流转（ADR-2 事件化）：事务内更新状态 + 写时间线事件 */
export function transitionApplication(id: number, input: TransitionInput): { application: Application; event: TimelineEvent } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as ApplicationRow | undefined;
  if (!row) throw AppError.notFound('申请');

  const from = row.status as AppStatus;
  const to: AppStatus = input.reopen ? STATUS.APPLIED : input.toStatus;

  if (input.reopen) {
    if (!TERMINAL_STATUSES.includes(from)) {
      throw AppError.invalidTransition('仅终态支持重新打开');
    }
  } else if (!canTransition(from, to)) {
    throw AppError.invalidTransition(`不允许从「${STATUS_LABELS[from]}」流转到「${STATUS_LABELS[to] ?? to}」`);
  }

  const occurredAt = input.occurredAt ?? nowIso();
  const now = nowIso();
  const title = input.reopen
    ? '重新打开投递流程'
    : `状态更新：${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`;

  const result = db.transaction(() => {
    db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?').run(to, now, id);
    const ev = db
      .prepare(
        `INSERT INTO timeline_events (application_id, event_type, from_status, to_status, title, description, occurred_at, created_at)
         VALUES (?, 'status_change', ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.reopen ? null : from, to, title, input.note ?? null, occurredAt, now);
    return Number(ev.lastInsertRowid);
  })();

  const event = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(result) as {
    id: number; application_id: number; event_type: string; from_status: string | null; to_status: string | null;
    title: string; description: string | null; occurred_at: string; created_at: string;
  };
  return {
    application: getApplication(id),
    event: {
      id: event.id,
      applicationId: event.application_id,
      eventType: event.event_type as TimelineEvent['eventType'],
      fromStatus: (event.from_status as AppStatus | null) ?? null,
      toStatus: (event.to_status as AppStatus | null) ?? null,
      title: event.title,
      description: event.description,
      occurredAt: event.occurred_at,
      createdAt: event.created_at,
    },
  };
}
