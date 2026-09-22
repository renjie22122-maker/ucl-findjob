import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error.js';
import type { Reminder } from '../domain/types.js';
import { nowIso } from '../utils/time.js';

interface ReminderRow {
  id: number;
  application_id: number;
  company_name: string | null;
  position_title: string | null;
  type: string;
  title: string;
  scheduled_at: string;
  done: number;
  done_at: string | null;
  created_at: string;
}

const BASE_SELECT = `
  SELECT r.*, c.name AS company_name, a.position_title AS position_title
  FROM reminders r
  JOIN applications a ON a.id = r.application_id
  JOIN companies c ON c.id = a.company_id
`;

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    applicationId: row.application_id,
    companyName: row.company_name ?? undefined,
    positionTitle: row.position_title ?? undefined,
    type: row.type as Reminder['type'],
    title: row.title,
    scheduledAt: row.scheduled_at,
    done: row.done as 0 | 1,
    doneAt: row.done_at,
    createdAt: row.created_at,
  };
}

export interface ReminderInput {
  applicationId: number;
  type: Reminder['type'];
  title: string;
  scheduledAt: string;
}

export function listReminders(filters: { from?: string; to?: string; done?: boolean } = {}): Reminder[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.from) {
    conditions.push('r.scheduled_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('r.scheduled_at < ?');
    params.push(filters.to);
  }
  if (filters.done !== undefined) {
    conditions.push('r.done = ?');
    params.push(filters.done ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`${BASE_SELECT} ${where} ORDER BY r.scheduled_at ASC, r.id DESC`).all(...params) as ReminderRow[];
  return rows.map(toReminder);
}

export function createReminder(input: ReminderInput): Reminder {
  const db = getDb();
  const app = db.prepare('SELECT id FROM applications WHERE id = ?').get(input.applicationId);
  if (!app) throw AppError.notFound('申请');
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO reminders (application_id, type, title, scheduled_at, done, done_at, created_at)
       VALUES (?, ?, ?, ?, 0, NULL, ?)`,
    )
    .run(input.applicationId, input.type, input.title, input.scheduledAt, now);
  const row = db.prepare(`${BASE_SELECT} WHERE r.id = ?`).get(Number(info.lastInsertRowid)) as ReminderRow;
  return toReminder(row);
}

export function updateReminder(id: number, input: Partial<ReminderInput>): Reminder {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as ReminderRow | undefined;
  if (!row) throw AppError.notFound('提醒');
  db.prepare(
    `UPDATE reminders SET application_id = ?, type = ?, title = ?, scheduled_at = ? WHERE id = ?`,
  ).run(
    input.applicationId ?? row.application_id,
    input.type ?? row.type,
    input.title ?? row.title,
    input.scheduledAt ?? row.scheduled_at,
    id,
  );
  const updated = db.prepare(`${BASE_SELECT} WHERE r.id = ?`).get(id) as ReminderRow;
  return toReminder(updated);
}

export function setReminderDone(id: number, done: boolean): Reminder {
  const db = getDb();
  const row = db.prepare('SELECT id FROM reminders WHERE id = ?').get(id);
  if (!row) throw AppError.notFound('提醒');
  const doneAt = done ? nowIso() : null;
  db.prepare('UPDATE reminders SET done = ?, done_at = ? WHERE id = ?').run(done ? 1 : 0, doneAt, id);
  const updated = db.prepare(`${BASE_SELECT} WHERE r.id = ?`).get(id) as ReminderRow;
  return toReminder(updated);
}

export function deleteReminder(id: number): void {
  const db = getDb();
  const row = db.prepare('SELECT id FROM reminders WHERE id = ?').get(id);
  if (!row) throw AppError.notFound('提醒');
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
}
