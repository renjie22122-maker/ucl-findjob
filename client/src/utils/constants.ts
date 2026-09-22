import type { AppStatus, EmailEventType, JobType, Priority, ReminderType } from '../types';

/** 与后端 domain/status.ts 保持同步（ADR-1 注释同步） */
export const STATUS_LABELS: Record<AppStatus, string> = {
  WISHLIST: '待投递',
  APPLIED: '已投递',
  SCREENING: '简历筛选',
  WRITTEN_TEST: '笔试',
  INTERVIEW_1: '一面',
  INTERVIEW_2: '二面',
  INTERVIEW_3: '三面',
  HR_INTERVIEW: 'HR面',
  OFFER: 'Offer',
  SIGNED: '已签约',
  REJECTED: '已拒绝',
  WITHDRAWN: '已放弃',
};

export const STATUS_COLORS: Record<AppStatus, string> = {
  WISHLIST: 'default',
  APPLIED: 'blue',
  SCREENING: 'cyan',
  WRITTEN_TEST: 'geekblue',
  INTERVIEW_1: 'purple',
  INTERVIEW_2: 'purple',
  INTERVIEW_3: 'purple',
  HR_INTERVIEW: 'magenta',
  OFFER: 'gold',
  SIGNED: 'green',
  REJECTED: 'red',
  WITHDRAWN: 'default',
};

export const TERMINAL_STATUSES: AppStatus[] = ['SIGNED', 'REJECTED', 'WITHDRAWN'];

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as AppStatus[];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  school: '校招',
  intern: '实习',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  HIGH: 'red',
  MEDIUM: 'orange',
  LOW: 'default',
};

export const CHANNEL_OPTIONS = ['官网', '牛客网', 'Boss直聘', '拉勾', '内推', '其他'];

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  written_test: '笔试',
  interview: '面试',
  deadline: '截止',
  other: '其他',
};

export const EMAIL_EVENT_LABELS: Record<EmailEventType, string> = {
  written_test: '笔试',
  interview: '面试',
  assessment: '测评',
  offer: 'Offer',
  reject: '拒信',
  other: '其他',
};

export const EMAIL_EVENT_COLORS: Record<EmailEventType, string> = {
  written_test: 'geekblue',
  interview: 'purple',
  assessment: 'cyan',
  offer: 'gold',
  reject: 'red',
  other: 'default',
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return iso.slice(0, 16).replace('T', ' ');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return iso.slice(0, 10);
}
