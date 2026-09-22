import { getDb } from '../db/connection.js';
import { STATUS, TERMINAL_STATUSES } from '../domain/status.js';
import type { OverviewStats, TrendPoint } from '../domain/types.js';
import { addDays, daysAgoStartIso, todayStartIso } from '../utils/time.js';

const INTERVIEW_STATES = [STATUS.WRITTEN_TEST, STATUS.INTERVIEW_1, STATUS.INTERVIEW_2, STATUS.INTERVIEW_3, STATUS.HR_INTERVIEW];
const OFFER_STATES = [STATUS.OFFER, STATUS.SIGNED];
const REJECTED_STATES = [STATUS.REJECTED, STATUS.WITHDRAWN];

function placeholders(arr: string[]): string {
  return arr.map(() => '?').join(',');
}

/** 看板统计（文档 04 §3.2 口径） */
export function getOverview(): OverviewStats {
  const db = getDb();
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { c: number }).c;

  const total = count('SELECT COUNT(*) AS c FROM applications');
  const active = count(
    `SELECT COUNT(*) AS c FROM applications WHERE status NOT IN (${placeholders(TERMINAL_STATUSES)})`,
    ...TERMINAL_STATUSES,
  );

  const byStatusRows = db
    .prepare('SELECT status, COUNT(*) AS c FROM applications GROUP BY status')
    .all() as { status: string; c: number }[];
  const byStatus: OverviewStats['byStatus'] = {};
  for (const r of byStatusRows) byStatus[r.status as keyof OverviewStats['byStatus']] = r.c;

  const offers = count(
    `SELECT COUNT(*) AS c FROM applications WHERE status IN (${placeholders(OFFER_STATES)})`,
    ...OFFER_STATES,
  );
  const signed = count('SELECT COUNT(*) AS c FROM applications WHERE status = ?', STATUS.SIGNED);
  const rejected = count(
    `SELECT COUNT(*) AS c FROM applications WHERE status IN (${placeholders(REJECTED_STATES)})`,
    ...REJECTED_STATES,
  );

  // 漏斗按事件推导（事件溯源，口径一致）
  const funnelApplied = count(
    `SELECT COUNT(DISTINCT application_id) AS c FROM timeline_events
     WHERE event_type = 'status_change' AND to_status IS NOT NULL AND to_status != ?`,
    STATUS.WISHLIST,
  );
  const funnelInterviewed = count(
    `SELECT COUNT(DISTINCT application_id) AS c FROM timeline_events
     WHERE event_type = 'status_change' AND to_status IN (${placeholders(INTERVIEW_STATES)})`,
    ...INTERVIEW_STATES,
  );
  const funnelOffer = count(
    `SELECT COUNT(DISTINCT application_id) AS c FROM timeline_events
     WHERE event_type = 'status_change' AND to_status IN (${placeholders(OFFER_STATES)})`,
    ...OFFER_STATES,
  );

  const todayStart = todayStartIso();
  const todayEnd = addDays(todayStart, 1);
  const todayCount = count(
    'SELECT COUNT(*) AS c FROM reminders WHERE done = 0 AND scheduled_at >= ? AND scheduled_at < ?',
    todayStart,
    todayEnd,
  );
  const overdueCount = count('SELECT COUNT(*) AS c FROM reminders WHERE done = 0 AND scheduled_at < ?', todayStart);

  // “新投递”按每条申请第一次离开待投递状态的事件统计，而不是记录创建时间。
  // 这样刚加入收藏的 WISHLIST 不会被误算，旧申请本周继续推进也不会重复算作新投递。
  const recentApplied7d = count(
    `SELECT COUNT(*) AS c FROM (
       SELECT application_id
       FROM timeline_events
       WHERE event_type = 'status_change' AND to_status IS NOT NULL AND to_status != ?
       GROUP BY application_id
       HAVING MIN(occurred_at) >= ?
     )`,
    STATUS.WISHLIST,
    daysAgoStartIso(7),
  );

  return {
    total,
    active,
    byStatus,
    offers,
    signed,
    rejected,
    funnel: { applied: funnelApplied, interviewed: funnelInterviewed, offer: funnelOffer },
    todayCount,
    overdueCount,
    recentApplied7d,
  };
}

/** 近 N 天趋势（按时间线事件聚合，文档 04 §3.3 口径） */
export function getTrends(days: number): TrendPoint[] {
  const db = getDb();
  const clamped = Math.min(365, Math.max(1, days));
  const start = daysAgoStartIso(clamped - 1);

  const rows = db
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS d, to_status, COUNT(*) AS c
       FROM timeline_events
       WHERE event_type = 'status_change' AND to_status IS NOT NULL AND occurred_at >= ?
       GROUP BY d, to_status`,
    )
    .all(start) as { d: string; to_status: string; c: number }[];

  const points: TrendPoint[] = [];
  for (let i = clamped - 1; i >= 0; i--) {
    const date = daysAgoStartIso(i).slice(0, 10);
    const bucket: TrendPoint = { date, applied: 0, interviewed: 0, offer: 0, rejected: 0 };
    for (const r of rows) {
      if (r.d !== date) continue;
      if (r.to_status === STATUS.APPLIED) bucket.applied += r.c;
      else if ((INTERVIEW_STATES as string[]).includes(r.to_status)) bucket.interviewed += r.c;
      else if ((OFFER_STATES as string[]).includes(r.to_status)) bucket.offer += r.c;
      else if ((REJECTED_STATES as string[]).includes(r.to_status)) bucket.rejected += r.c;
    }
    points.push(bucket);
  }
  return points;
}
