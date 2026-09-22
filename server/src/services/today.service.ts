import { listReminders } from './reminders.service.js';
import type { Reminder } from '../domain/types.js';
import { addDays, todayStartIso } from '../utils/time.js';

export interface TodayPayload {
  date: string;
  overdue: Reminder[];
  today: Reminder[];
  upcoming: Reminder[];
}

/** 今日提醒：过期 / 今天 / 未来 3 天（文档 04 §3.4） */
export function getToday(): TodayPayload {
  const todayStart = todayStartIso();
  const todayEnd = addDays(todayStart, 1);
  const upcomingEnd = addDays(todayStart, 4);

  const overdue = listReminders({ to: todayStart, done: false });
  const today = listReminders({ from: todayStart, to: todayEnd, done: false });
  const upcoming = listReminders({ from: todayEnd, to: upcomingEnd, done: false });

  return { date: todayStart.slice(0, 10), overdue, today, upcoming };
}
