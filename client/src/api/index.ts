import { downloadFile, http, uploadFile } from './http';
import type {
  ActionListItem,
  Application,
  ApplicationFilters,
  ApplyBatchResult,
  AuditEntry,
  BatchMatchResultItem,
  Company,
  CrawlJob,
  CrawlResult,
  CrawlRun,
  DeviceCodeStart,
  EmailItem,
  GithubImportResult,
  ImportResult,
  InterviewQuestion,
  MatchAllItem,
  MatchResult,
  LinkedinSearchPlan,
  JobRecommendation,
  ManualRecommendationInput,
  Oauth2PollResult,
  OfferCompareResult,
  OverviewStats,
  Paginated,
  ParsedInterview,
  ParsedResume,
  PolishResult,
  RawJobRecord,
  Reminder,
  Resume,
  ResumeEducation,
  ReviewResult,
  RecommendationBatchImportResult,
  RecommendationRun,
  RecommendationStatus,
  SettingsPayload,
  SearchProfile,
  SearchProfileInput,
  SourceInfo,
  TimelineEvent,
  TodayPayload,
  TrendPoint,
} from '../types';

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || typeof v === 'function') continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------- companies ----------
export const companiesApi = {
  list: (keyword?: string) => http.get<{ items: (Company & { applicationCount: number })[] }>(`/companies${qs({ keyword })}`),
  create: (body: Partial<Company>) => http.post<Company>('/companies', body),
  update: (id: number, body: Partial<Company>) => http.put<Company>(`/companies/${id}`, body),
  remove: (id: number) => http.del<void>(`/companies/${id}`),
};

// ---------- applications ----------
export const applicationsApi = {
  list: (filters: ApplicationFilters) =>
    http.get<Paginated<Application>>(`/applications${qs(filters as Record<string, unknown>)}`),
  get: (id: number) => http.get<Application & { timeline: TimelineEvent[] }>(`/applications/${id}`),
  create: (body: Partial<Application>) => http.post<Application>('/applications', body),
  update: (id: number, body: Partial<Application>) => http.put<Application>(`/applications/${id}`, body),
  remove: (id: number) => http.del<void>(`/applications/${id}`),
  transition: (id: number, body: { toStatus: string; note?: string | null; occurredAt?: string; reopen?: boolean }) =>
    http.post<{ application: Application; event: TimelineEvent }>(`/applications/${id}/transitions`, body),
  addNote: (id: number, body: { title: string; description?: string | null; occurredAt?: string }) =>
    http.post<TimelineEvent>(`/applications/${id}/timeline`, body),
};

// ---------- reminders ----------
export const remindersApi = {
  list: (filters: { from?: string; to?: string; done?: boolean } = {}) =>
    http.get<{ items: Reminder[] }>(`/reminders${qs(filters)}`),
  create: (body: Partial<Reminder>) => http.post<Reminder>('/reminders', body),
  update: (id: number, body: Partial<Reminder>) => http.put<Reminder>(`/reminders/${id}`, body),
  setDone: (id: number, done: boolean) => http.patch<Reminder>(`/reminders/${id}/done`, { done }),
  remove: (id: number) => http.del<void>(`/reminders/${id}`),
};

// ---------- stats / today ----------
export const statsApi = {
  overview: () => http.get<OverviewStats>('/stats/overview'),
  trends: (days = 30) => http.get<{ items: TrendPoint[] }>(`/stats/trends?days=${days}`),
  today: () => http.get<TodayPayload>('/stats/today'),
};

// ---------- sources / import / export ----------
export const sourcesApi = {
  list: () => http.get<{ items: SourceInfo[] }>('/sources'),
  crawl: (body: { sourceId: string; params: Record<string, unknown> }) => http.post<CrawlResult>('/crawl', body),
  crawlMany: (body: { sourceIds: string[]; params: Record<string, unknown> }) => http.post<CrawlResult>('/crawl/many', body),
  importRecords: (records: RawJobRecord[]) => http.post<ImportResult>('/import/records', { records }),
  importExcel: (file: File) => uploadFile<ImportResult>('/import/excel', file),
  exportExcel: (filters: Record<string, unknown> = {}) => downloadFile(`/export/excel${qs(filters)}`, `findjob-export-${Date.now()}.xlsx`),
  downloadTemplate: () => downloadFile('/export/template', 'findjob-template.xlsx'),
};

// ---------- 快照导出 / GitHub Pages 发布 ----------
export const snapshotApi = {
  exportJson: () => downloadFile('/export/snapshot', 'findjob-snapshot.json'),
  exportHtml: () => downloadFile('/export/snapshot.html', 'findjob-snapshot.html'),
  publish: (repoPath: string, message?: string) =>
    http.post<{ ok: boolean; output: string }>('/export/publish', { repoPath, message }),
};

// ---------- 定时自动抓取 ----------
export const crawlJobsApi = {
  list: () => http.get<{ items: CrawlJob[] }>('/crawl-jobs'),
  create: (body: Partial<CrawlJob>) => http.post<CrawlJob>('/crawl-jobs', body),
  update: (id: number, body: Partial<CrawlJob>) => http.put<CrawlJob>(`/crawl-jobs/${id}`, body),
  remove: (id: number) => http.del<void>(`/crawl-jobs/${id}`),
  runNow: (id: number) => http.post<{ started: boolean }>(`/crawl-jobs/${id}/run-now`),
  runs: (filters: { page?: number; pageSize?: number } = {}) => http.get<Paginated<CrawlRun>>(`/crawl-runs${qs(filters)}`),
};

// ---------- settings ----------
export const settingsApi = {
  get: () => http.get<SettingsPayload>('/settings'),
  update: (body: {
    email?: { authMode: 'password' | 'oauth2'; host: string; port: number; secure: boolean; user: string; password?: string; folder: string };
    llm?: { baseUrl: string; apiKey?: string; model: string };
  }) => http.put<SettingsPayload>('/settings', body),
  testEmail: () => http.post<{ ok: boolean; message: string }>('/settings/test-email'),
  testLlm: () => http.post<{ ok: boolean; message: string }>('/settings/test-llm'),
};

// ---------- outlook oauth2 ----------
export const oauth2Api = {
  status: () => http.get<{ configured: boolean; user: string | null }>('/oauth2/status'),
  start: (tenant: string, clientId: string) => http.post<DeviceCodeStart>('/oauth2/start', { tenant, clientId }),
  poll: (tenant: string, clientId: string, deviceCode: string) =>
    http.post<Oauth2PollResult>('/oauth2/poll', { tenant, clientId, deviceCode }),
  disconnect: () => http.post<{ ok: boolean }>('/oauth2/disconnect'),
};

// ---------- 出站调用审计 ----------
export const auditApi = {
  list: (filters: { kind?: string; page?: number; pageSize?: number } = {}) =>
    http.get<Paginated<AuditEntry>>(`/audit${qs(filters)}`),
  clear: () => http.del<void>('/audit'),
};

// ---------- email analysis ----------
export const emailApi = {
  analyze: (days = 14) => http.post<{ fetched: number; candidates: number; analyzed: number; skipped: number }>('/email/analyze', { days }),
  items: (filters: { status?: string; page?: number; pageSize?: number }) =>
    http.get<Paginated<EmailItem>>(`/email/items${qs(filters)}`),
  apply: (id: number, extracted?: EmailItem['extracted']) =>
    http.post<{
      item: EmailItem;
      timelineEvent: TimelineEvent | null;
      reminder: Reminder | null;
      warning: string | null;
    }>(`/email/items/${id}/apply`, extracted ? { extracted } : {}),
  dismiss: (id: number) => http.post<EmailItem>(`/email/items/${id}/dismiss`),
  applyBatch: (minConfidence = 0.8) => http.post<ApplyBatchResult>('/email/apply-batch', { minConfidence }),
};

// ---------- utils ----------
export const utilsApi = {
  parseJd: (url: string) =>
    http.post<{ title: string; companyHint: string | null; description: string; ok: boolean }>('/utils/parse-jd', { url }),
};

// ---------- 简历管理 ----------
export const resumesApi = {
  list: () => http.get<{ items: Resume[] }>('/resumes'),
  get: (id: number) => http.get<Resume>(`/resumes/${id}`),
  create: (body: Partial<Resume>) => http.post<Resume>('/resumes', body),
  update: (id: number, body: Partial<Resume>) => http.put<Resume>(`/resumes/${id}`, body),
  remove: (id: number) => http.del<void>(`/resumes/${id}`),
  parseText: (text: string) => http.post<ParsedResume>('/resumes/parse-text', { text }),
  importGithub: (username: string) => http.post<GithubImportResult>('/resumes/import-github', { username }),
  parseCertificate: (imageBase64: string, mimeType: string, certType: 'degree' | 'diploma' | 'other') =>
    http.post<Partial<ResumeEducation>>('/resumes/parse-certificate', { imageBase64, mimeType, certType }),
  generate: (id: number, jobTitle?: string, company?: string) =>
    http.post<{ content: string }>(`/resumes/${id}/generate`, { jobTitle, company }),
  parsePdf: (file: File) => uploadFile<{ structured: ParsedResume | null; text: string; warning?: string }>('/resumes/parse-pdf', file),
  exportHtmlUrl: (id: number) => `/api/resumes/${id}/export.html`,
};

// ---------- AI 能力 ----------
export const aiApi = {
  review: (resumeId: number) => http.post<ReviewResult>('/ai/review', { resumeId }),
  match: (resumeId: number, applicationId: number) => http.post<MatchResult>('/ai/match', { resumeId, applicationId }),
  matchBatch: (
    resumeId: number,
    items: Array<Pick<BatchMatchResultItem, 'sourceKey' | 'companyName' | 'positionTitle' | 'jdDescription' | 'city'>>,
  ) =>
    http.post<BatchMatchResultItem[]>('/ai/match-batch', { resumeId, items }),
  matchAll: (resumeId: number) => http.post<{ items: MatchAllItem[] }>('/ai/match-all', { resumeId }),
  coverLetter: (resumeId: number, applicationId: number) =>
    http.post<{ content: string }>('/ai/cover-letter', { resumeId, applicationId }),
  interviewQuestions: (resumeId: number, applicationId: number) =>
    http.post<{ questions: InterviewQuestion[] }>('/ai/interview-questions', { resumeId, applicationId }),
  polish: (resumeId: number, jobTitle?: string) => http.post<PolishResult>('/ai/polish', { resumeId, jobTitle }),
  parseInterview: (text: string) =>
    http.post<ParsedInterview & { ruleBased: boolean }>('/ai/parse-interview', { text }),
  compareOffers: (applicationIds: number[]) =>
    http.post<OfferCompareResult & { ruleBased: boolean }>('/ai/compare-offers', { applicationIds }),
  actionList: (resumeId: number, topN = 20) => http.post<{ items: ActionListItem[] }>('/ai/action-list', { resumeId, topN }),
};

// ---------- 官网自动填表助手（实验性） ----------
export const autofillApi = {
  fill: (applicationId: number, targetUrl?: string) =>
    http.post<{ filledFields: string[]; message: string }>('/autofill', { applicationId, targetUrl }),
};

// ---------- 基于简历的智能岗位推荐 ----------
export const recommendationsApi = {
  profiles: () => http.get<{ items: SearchProfile[] }>('/recommendations/profiles'),
  createProfile: (body: SearchProfileInput) => http.post<SearchProfile>('/recommendations/profiles', body),
  updateProfile: (id: number, body: Partial<SearchProfileInput>) =>
    http.put<SearchProfile>(`/recommendations/profiles/${id}`, body),
  removeProfile: (id: number) => http.del<void>(`/recommendations/profiles/${id}`),
  runProfile: (id: number) => http.post<RecommendationRun>(`/recommendations/profiles/${id}/run`),
  linkedinPlan: (id: number) =>
    http.get<LinkedinSearchPlan>(`/recommendations/profiles/${id}/linkedin-plan`),
  list: (filters: {
    profileId?: number;
    status?: RecommendationStatus;
    sourceId?: string;
    minScore?: number;
    keyword?: string;
    page?: number;
    pageSize?: number;
  } = {}) => http.get<Paginated<JobRecommendation>>(`/recommendations${qs(filters)}`),
  addManual: (body: ManualRecommendationInput) =>
    http.post<JobRecommendation>('/recommendations/manual', body),
  setStatus: (id: number, status: Exclude<RecommendationStatus, 'imported'>) =>
    http.put<JobRecommendation>(`/recommendations/${id}/status`, { status }),
  importOne: (id: number) =>
    http.post<{ recommendation: JobRecommendation; applicationId: number; imported: boolean }>(
      `/recommendations/${id}/import`,
    ),
  importBatch: (ids: number[]) =>
    http.post<RecommendationBatchImportResult>('/recommendations/import-batch', { ids }),
  runs: (filters: { profileId?: number; page?: number; pageSize?: number } = {}) =>
    http.get<Paginated<RecommendationRun>>(`/recommendations/runs${qs(filters)}`),
};
