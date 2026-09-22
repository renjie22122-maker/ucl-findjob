export type AppStatus =
  | 'WISHLIST'
  | 'APPLIED'
  | 'SCREENING'
  | 'WRITTEN_TEST'
  | 'INTERVIEW_1'
  | 'INTERVIEW_2'
  | 'INTERVIEW_3'
  | 'HR_INTERVIEW'
  | 'OFFER'
  | 'SIGNED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type JobType = 'school' | 'intern';
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type ReminderType = 'written_test' | 'interview' | 'deadline' | 'other';
export type EmailEventType = 'written_test' | 'interview' | 'assessment' | 'offer' | 'reject' | 'other';

export interface Company {
  id: number;
  name: string;
  industry: string | null;
  city: string | null;
  website: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  applicationCount?: number;
}

export interface Application {
  id: number;
  companyId: number;
  companyName?: string;
  positionTitle: string;
  jobType: JobType;
  channel: string | null;
  jdUrl: string | null;
  jdDescription?: string | null;
  status: AppStatus;
  priority: Priority;
  deadline: string | null;
  appliedAt: string | null;
  note: string | null;
  resumeId: number | null;
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
  type: ReminderType;
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

export interface RawJobRecord {
  sourceKey?: string;
  companyName: string;
  companyIndustry?: string;
  companyCity?: string;
  companyWebsite?: string;
  positionTitle: string;
  jobType?: JobType;
  channel?: string;
  jdUrl?: string;
  appliedAt?: string;
  deadline?: string;
  status?: string;
  priority?: Priority;
  note?: string;
  salary?: string;
  city?: string;
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
  pendingEmails?: number;
}

export interface TrendPoint {
  date: string;
  applied: number;
  interviewed: number;
  offer: number;
  rejected: number;
}

export interface TodayPayload {
  date: string;
  overdue: Reminder[];
  today: Reminder[];
  upcoming: Reminder[];
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

export interface CrawlJob {
  id: number;
  sourceId: string;
  keyword: string;
  recruitType: 'school' | 'intern';
  maxPages: number;
  frequency: 'daily' | 'weekly';
  enabled: 0 | 1;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlRun {
  id: number;
  jobId: number | null;
  sourceId: string;
  keyword: string;
  status: 'running' | 'success' | 'failed';
  fetched: number;
  imported: number;
  skipped: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ApplyBatchResult {
  applied: number;
  skipped: number;
  results: Array<{ id: number; ok: boolean; message: string }>;
}

export interface EmailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  folder: string;
  authMode: 'password' | 'oauth2';
  tenant?: string;
  clientId?: string;
  passwordSet: boolean;
}

export interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
}

export interface SettingsPayload {
  email: EmailSettings | null;
  llm: LlmSettings | null;
  oauth2: { configured: boolean; user: string | null };
}

export interface DeviceCodeStart {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface Oauth2PollResult {
  status: 'pending' | 'slow_down' | 'complete' | 'expired' | 'error';
  email?: string;
  message?: string;
}

export type AuditKind = 'crawl' | 'imap' | 'llm' | 'oauth2' | 'jd-parse' | 'github' | 'ai' | 'publish' | 'autofill';

export interface AuditEntry {
  id: number;
  kind: AuditKind;
  target: string;
  detail: string | null;
  status: 'success' | 'failed';
  result: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string;
}

export interface ResumeBasic {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  github?: string;
  blog?: string;
  summary?: string;
}

export interface ResumeEducation {
  school: string;
  degree?: string;
  major?: string;
  start?: string;
  end?: string;
  gpa?: string;
  note?: string;
}

export interface ResumeExperience {
  company: string;
  role?: string;
  start?: string;
  end?: string;
  description: string[];
}

export interface ResumeProject {
  name: string;
  role?: string;
  link?: string;
  tech?: string[];
  description: string[];
}

export interface Resume {
  id: number;
  name: string;
  targetRole: string | null;
  basic: ResumeBasic | null;
  education: ResumeEducation[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  skills: string[];
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedResume {
  basic: ResumeBasic;
  education: ResumeEducation[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  skills: string[];
}

export interface GithubImportResult {
  profile: {
    login: string;
    name: string | null;
    bio: string | null;
    company: string | null;
    location: string | null;
    blog: string | null;
    avatarUrl: string | null;
  };
  repos: Array<{
    name: string;
    description: string | null;
    language: string | null;
    htmlUrl: string;
    stars: number;
    fork: boolean;
  }>;
}

export interface ReviewResult {
  score: number;
  issues: Array<{ severity: 'high' | 'medium' | 'low'; section: string; advice: string }>;
  summary: string;
  ruleBased: boolean;
}

export interface MatchResult {
  score: number;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  summary: string;
  ruleBased: boolean;
}

export interface BatchMatchResultItem {
  sourceKey?: string;
  companyName: string;
  positionTitle: string;
  jdDescription?: string | null;
  city?: string | null;
  score: number;
  summary: string;
  ruleBased: boolean;
}

export interface MatchAllItem {
  applicationId: number;
  companyName: string;
  positionTitle: string;
  status: AppStatus;
  jobType: JobType;
  city: string | null;
  channel: string | null;
  deadline: string | null;
  jdUrl: string | null;
  score: number;
  educationReq: '学历不限' | '大专' | '本科' | '硕士' | '博士' | null;
  educationMatch: boolean | null;
  skillHits: string[];
  skillMisses: string[];
  cityMatch: boolean | null;
}

export interface ApplicationFilters {
  statuses?: AppStatus[];
  companyId?: number;
  jobType?: JobType;
  priority?: Priority;
  keyword?: string;
  sortBy?: 'updatedAt' | 'appliedAt' | 'deadline';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface InterviewQuestion {
  question: string;
  category: '技术' | '业务' | '行为' | '情景';
  difficulty: '简单' | '中等' | '困难';
  tips: string;
  sample: string;
}

export interface PolishSuggestion {
  section: string;
  original: string;
  improved: string;
  reason: string;
}

export interface PolishResult {
  suggestions: PolishSuggestion[];
  overall: string;
  keywords: string[];
  score: number;
}

export interface ParsedInterview {
  round: string;
  questions: string[];
  feeling: string;
  result: string;
  suggestions: string[];
}

export interface OfferCompareResult {
  comparison: Array<{ company: string; positionTitle: string; pros: string[]; cons: string[]; score: number }>;
  recommendation: string;
  salaryAdvice: string;
  summary: string;
  ruleBased: boolean;
}

export interface ActionListItem extends MatchAllItem {
  urgency: number;
  actionScore: number;
}

export type RecommendationStatus = 'new' | 'saved' | 'dismissed' | 'imported';
export type RecommendationFrequency = 'manual' | 'daily' | 'weekly';

/** 一组可复用的简历找岗条件。关键词和城市可由后端从简历中派生。 */
export interface SearchProfile {
  id: number;
  resumeId: number;
  name: string;
  keywords: string[];
  cities: string[];
  sourceIds: string[];
  recruitType: JobType;
  minScore: number;
  maxPages: number;
  frequency: RecommendationFrequency;
  enabled: 0 | 1;
  autoImport: 0 | 1;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SearchProfileInput = Pick<SearchProfile, 'resumeId' | 'name'> &
  Partial<
    Pick<
      SearchProfile,
      | 'keywords'
      | 'cities'
      | 'sourceIds'
      | 'recruitType'
      | 'minScore'
      | 'maxPages'
      | 'frequency'
    >
  > & {
    enabled?: boolean;
    autoImport?: boolean;
  };

export interface JobRecommendation {
  id: number;
  profileId: number;
  sourceId: string;
  sourceKey: string;
  companyName: string;
  companyIndustry: string | null;
  companyCity: string | null;
  companyWebsite: string | null;
  positionTitle: string;
  jobType: JobType;
  channel: string | null;
  jdUrl: string | null;
  deadline: string | null;
  salary: string | null;
  city: string | null;
  jdDescription: string | null;
  score: number;
  summary: string;
  reasons: string[];
  status: RecommendationStatus;
  applicationId: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationRun {
  id: number;
  profileId: number;
  status: 'running' | 'success' | 'failed';
  fetched: number;
  matched: number;
  saved: number;
  imported: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface LinkedinSearchPlan {
  profileId: number;
  queries: Array<{
    keywords: string;
    location: string | null;
    queryText: string;
  }>;
  notice: string;
}

export interface ManualRecommendationInput {
  profileId: number;
  sourceId?: 'linkedin-manual' | 'manual';
  sourceKey?: string;
  companyName: string;
  positionTitle: string;
  jobType?: JobType;
  channel?: string;
  jdUrl?: string;
  deadline?: string;
  salary?: string;
  city?: string;
  jdDescription?: string;
}

export interface RecommendationBatchImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ id: number; message: string }>;
  items: JobRecommendation[];
}
