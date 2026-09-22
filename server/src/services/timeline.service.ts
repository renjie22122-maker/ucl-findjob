import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error.js';
import type { TimelineEvent } from '../domain/types.js';
import { nowIso } from '../utils/time.js';

interface TimelineRow {
  id: number;
  application_id: number;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  title: string;
  description: string | null;
  occurred_at: string;
  created_at: string;
}

function toEvent(row: TimelineRow): TimelineEvent {
  return {
    id: row.id,
    applicationId: row.application_id,
    eventType: row.event_type as TimelineEvent['eventType'],
    fromStatus: (row.from_status as TimelineEvent['fromStatus']) ?? null,
    toStatus: (row.to_status as TimelineEvent['toStatus']) ?? null,
    title: row.title,
    description: row.description,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

export function listTimeline(applicationId: number): TimelineEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM timeline_events WHERE application_id = ? ORDER BY occurred_at DESC, id DESC')
    .all(applicationId) as TimelineRow[];
  return rows.map(toEvent);
}

export function addNote(applicationId: number, title: string, description?: string | null, occurredAt?: string): TimelineEvent {
  const db = getDb();
  const app = db.prepare('SELECT id FROM applications WHERE id = ?').get(applicationId);
  if (!app) throw AppError.notFound('申请');
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO timeline_events (application_id, event_type, from_status, to_status, title, description, occurred_at, created_at)
       VALUES (?, 'note', NULL, NULL, ?, ?, ?, ?)`,
    )
    .run(applicationId, title, description ?? null, occurredAt ?? now, now);
  const row = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(Number(info.lastInsertRowid)) as TimelineRow;
  return toEvent(row);
}
