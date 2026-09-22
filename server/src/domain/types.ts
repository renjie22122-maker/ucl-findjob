import type { AppStatus, EmailEventType } from './status.js';

export interface Company {
  id: number;
  name: string;
  industry: string | null;
  city: string | null;
  website: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: number;
  companyId: number;
  companyName?: string;
  positionTitle: string;
  jobType: 'school' | 'intern';
  channel: string | null;
  jdUrl: string | null;
  status: AppStatus;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  deadline: string | null;
  appliedAt: string | null;
  note: string | null;
  resumeId: number | null;
  jdDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: number;
  applicationId: number;
  eventType: 'status_change' | 'note';
  fromStatus: AppStatus | null;
  toStatus: AppStatus | null;
  title: string;
  description: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface Reminder {
  id: number;
  applicationId: number;
  companyName?: string;
  positionTitle?: string;
  type: 'written_test' | 'interview' | 'deadline' | 'other';
  title: string;
  scheduledAt: string;
  done: 0 | 1;
  doneAt: string | null;
  createdAt: string;
}

export interface EmailExtraction {
  company: string | null;
  eventType: EmailEventType | null;
  eventTime: string | null;
  positionTitle: string | null;
  summary: string | null;
  confidence: number;
}

export interface EmailItem {
  id: number;
  messageId: string;
  subject: string;
  sender: string | null;
  receivedAt: string;
  snippet: string | null;
  extracted: EmailExtraction | null;
  status: 'pending' | 'confirmed' | 'dismissed';
  applicationId: number | null;
  createdAt: string;
  appliedAt: string | null;
}

/** 数据接入层：归一化投递记录（文档 06 §2） */
export interface RawJobRecord {
  companyName: string;
  companyIndustry?: string;
  companyCity?: string;
  companyWebsite?: string;
  positionTitle: string;
  jobType?: 'school' | 'intern';
  channel?: string;
  jdUrl?: string;
  appliedAt?: string;
  deadline?: string;
  status?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  note?: string;
  salary?: string;
  city?: string;
  sourceKey?: string;
  jdDescription?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row?: number; message: string }>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OverviewStats {
  total: number;
  active: number;
  byStatus: Partial<Record<AppStatus, number>>;
  offers: number;
  signed: number;
  rejected: number;
  funnel: { applied: number; interviewed: number; offer: number };
  todayCount: number;
  overdueCount: number;
  recentApplied7d: number;
}

export interface TrendPoint {
  date: string;
  applied: number;
  interviewed: number;
  offer: number;
  rejected: number;
}

export interface SourceParamOption {
  value: string;
  label: string;
}

export interface SourceParam {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  required?: boolean;
  default?: string | number;
  max?: number;
  options?: SourceParamOption[];
}

export interface SourceInfo {
  id: string;
  name: string;
  description: string;
  experimental?: boolean;
  params: SourceParam[];
}

export interface CrawlResult {
  sourceId: string;
  count: number;
  records: RawJobRecord[];
}
