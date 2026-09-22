/**
 * 时间工具：统一使用本地时区的 ISO 字符串（YYYY-MM-DDTHH:mm:ss，无 Z）。
 * 存储格式一致，字符串比较即时间比较（文档 01 §6）。
 */

export function localIso(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 19);
}

export function nowIso(): string {
  return localIso(new Date());
}

/** 今天零点 */
export function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return localIso(d);
}

export function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setDate(d.getDate() + days);
  return localIso(d);
}

/** n 天前的零点（用于区间起始） */
export function daysAgoStartIso(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return localIso(d);
}
