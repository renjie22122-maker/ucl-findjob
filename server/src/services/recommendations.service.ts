import { createHash } from 'node:crypto';
import { crawl, getSource, type CrawlParams } from '../adapters/registry.js';
import { getDb } from '../db/connection.js';
import type { CrawlResult, Paginated, RawJobRecord } from '../domain/types.js';
import { AppError } from '../middleware/error.js';
import { nowIso } from '../utils/time.js';
import { structuredMatch, type StructuredMatch } from './ai.service.js';
import { importRecords } from './import.service.js';
import { getResume, type Resume } from './resumes.service.js';

export type ProfileFrequency = 'manual' | 'daily' | 'weekly';
export type RecommendationStatus = 'new' | 'saved' | 'dismissed' | 'imported';
export type RecommendationRunStatus = 'running' | 'success' | 'failed';

export interface SearchProfile {
  id: number;
  resumeId: number;
  name: string;
  keywords: string[];
  cities: string[];
  sourceIds: string[];
  recruitType: 'school' | 'intern';
  minScore: number;
  maxPages: number;
  frequency: ProfileFrequency;
  enabled: 0 | 1;
  autoImport: 0 | 1;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchProfileInput {
  resumeId: number;
  name: string;
  keywords?: string[];
  cities?: string[];
  sourceIds?: string[];
  recruitType?: 'school' | 'intern';
  minScore?: number;
  maxPages?: number;
  frequency?: ProfileFrequency;
  enabled?: boolean;
  autoImport?: boolean;
}

export interface RecommendationRun {
  id: number;
  profileId: number;
  status: RecommendationRunStatus;
  fetched: number;
  matched: number;
  saved: number;
  imported: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

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
  jobType: 'school' | 'intern';
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

interface ProfileRow {
  id: number;
  resume_id: number;
  name: string;
  keywords: string;
  cities: string;
  source_ids: string;
  recruit_type: string;
  min_score: number;
  max_pages: number;
  frequency: string;
  enabled: number;
  auto_import: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: number;
  profile_id: number;
  status: string;
  fetched: number;
  matched: number;
  saved: number;
  imported: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface RecommendationRow {
  id: number;
  profile_id: number;
  source_id: string;
  source_key: string;
  company_name: string;
  company_industry: string | null;
  company_city: string | null;
  company_website: string | null;
  position_title: string;
  job_type: string;
  channel: string | null;
  jd_url: string | null;
  deadline: string | null;
  salary: string | null;
  city: string | null;
  jd_description: string | null;
  score: number;
  summary: string;
  reasons: string;
  status: string;
  application_id: number | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeList(values: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, ' ');
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function toProfile(row: ProfileRow): SearchProfile {
  return {
    id: row.id,
    resumeId: row.resume_id,
    name: row.name,
    keywords: parseStringArray(row.keywords),
    cities: parseStringArray(row.cities),
    sourceIds: parseStringArray(row.source_ids),
    recruitType: row.recruit_type as SearchProfile['recruitType'],
    minScore: row.min_score,
    maxPages: row.max_pages,
    frequency: row.frequency as ProfileFrequency,
    enabled: row.enabled as 0 | 1,
    autoImport: row.auto_import as 0 | 1,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: RunRow): RecommendationRun {
  return {
    id: row.id,
    profileId: row.profile_id,
    status: row.status as RecommendationRunStatus,
    fetched: row.fetched,
    matched: row.matched,
    saved: row.saved,
    imported: row.imported,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toRecommendation(row: RecommendationRow): JobRecommendation {
  return {
    id: row.id,
    profileId: row.profile_id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    companyName: row.company_name,
    companyIndustry: row.company_industry,
    companyCity: row.company_city,
    companyWebsite: row.company_website,
    positionTitle: row.position_title,
    jobType: row.job_type as JobRecommendation['jobType'],
    channel: row.channel,
    jdUrl: row.jd_url,
    deadline: row.deadline,
    salary: row.salary,
    city: row.city,
    jdDescription: row.jd_description,
    score: row.score,
    summary: row.summary,
    reasons: parseStringArray(row.reasons),
    status: row.status as RecommendationStatus,
    applicationId: row.application_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 从简历的求职意向、技能和城市确定性生成搜索画像，不调用 LLM。 */
export function deriveSearchProfile(resume: Resume): { keywords: string[]; cities: string[] } {
  const targetRole = resume.targetRole?.trim() ?? '';
  const roleParts = targetRole ? targetRole.split(/[，,、;；/|]+/) : [];
  const primaryRole = roleParts.find((item) => item.trim())?.trim() || targetRole;
  const roleAndSkill = primaryRole
    ? resume.skills.slice(0, 6).map((skill) => `${primaryRole} ${skill}`)
    : resume.skills;
  // 技能优先与岗位组合，避免用“Git / SQL”等泛技能单独产生大量噪声。
  const keywords = normalizeList([targetRole, ...roleParts, ...roleAndSkill], 8);
  const city = resume.basic?.city?.trim() ?? '';
  return { keywords, cities: normalizeList([city], 5) };
}

function validateSourceIds(sourceIds: string[]): void {
  for (const sourceId of sourceIds) getSource(sourceId);
}

export function listSearchProfiles(): SearchProfile[] {
  const rows = getDb().prepare('SELECT * FROM job_search_profiles ORDER BY updated_at DESC, id DESC').all() as ProfileRow[];
  return rows.map(toProfile);
}

export function getSearchProfile(id: number): SearchProfile {
  const row = getDb().prepare('SELECT * FROM job_search_profiles WHERE id = ?').get(id) as ProfileRow | undefined;
  if (!row) throw AppError.notFound('搜索画像');
  return toProfile(row);
}

export function createSearchProfile(input: SearchProfileInput): SearchProfile {
  const resume = getResume(input.resumeId);
  const derived = deriveSearchProfile(resume);
  const keywords = normalizeList(input.keywords?.length ? input.keywords : derived.keywords, 8);
  const cities = normalizeList(input.cities ?? derived.cities, 5);
  const sourceIds = normalizeList(input.sourceIds ?? ['nowcoder'], 5);
  if (!keywords.length) throw AppError.validation('简历缺少求职意向和技能，请补充后再创建搜索画像');
  if (!sourceIds.length) throw AppError.validation('至少选择一个岗位数据源');
  validateSourceIds(sourceIds);

  const now = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO job_search_profiles
       (resume_id, name, keywords, cities, source_ids, recruit_type, min_score, max_pages,
        frequency, enabled, auto_import, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      input.resumeId,
      input.name.trim(),
      JSON.stringify(keywords),
      JSON.stringify(cities),
      JSON.stringify(sourceIds),
      input.recruitType ?? 'school',
      input.minScore ?? 60,
      input.maxPages ?? 3,
      input.frequency ?? 'manual',
      input.enabled === false ? 0 : 1,
      input.autoImport ? 1 : 0,
      now,
      now,
    );
  return getSearchProfile(Number(info.lastInsertRowid));
}

export function updateSearchProfile(id: number, input: Partial<SearchProfileInput>): SearchProfile {
  const current = getSearchProfile(id);
  const resumeId = input.resumeId ?? current.resumeId;
  const resume = getResume(resumeId);
  const derived = deriveSearchProfile(resume);
  const keywords = normalizeList(
    input.keywords
      ? input.keywords.length
        ? input.keywords
        : derived.keywords
      : input.resumeId !== undefined && input.resumeId !== current.resumeId
        ? derived.keywords
        : current.keywords,
    8,
  );
  const cities = normalizeList(
    input.cities ?? (input.resumeId !== undefined && input.resumeId !== current.resumeId ? derived.cities : current.cities),
    5,
  );
  const sourceIds = normalizeList(input.sourceIds ?? current.sourceIds, 5);
  if (!keywords.length) throw AppError.validation('搜索关键词不能为空');
  if (!sourceIds.length) throw AppError.validation('至少选择一个岗位数据源');
  validateSourceIds(sourceIds);

  getDb()
    .prepare(
      `UPDATE job_search_profiles SET
       resume_id = ?, name = ?, keywords = ?, cities = ?, source_ids = ?, recruit_type = ?,
       min_score = ?, max_pages = ?, frequency = ?, enabled = ?, auto_import = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      resumeId,
      (input.name ?? current.name).trim(),
      JSON.stringify(keywords),
      JSON.stringify(cities),
      JSON.stringify(sourceIds),
      input.recruitType ?? current.recruitType,
      input.minScore ?? current.minScore,
      input.maxPages ?? current.maxPages,
      input.frequency ?? current.frequency,
      input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
      input.autoImport === undefined ? current.autoImport : input.autoImport ? 1 : 0,
      nowIso(),
      id,
    );
  return getSearchProfile(id);
}

export function deleteSearchProfile(id: number): void {
  getSearchProfile(id);
  getDb().prepare('DELETE FROM job_search_profiles WHERE id = ?').run(id);
}

/** 调度判断：手动画像永不到期；daily/weekly 采用实际经过时长。 */
export function isProfileDue(profile: SearchProfile, now = new Date()): boolean {
  if (!profile.enabled || profile.frequency === 'manual') return false;
  if (!profile.lastRunAt) return true;
  const last = Date.parse(profile.lastRunAt);
  if (!Number.isFinite(last)) return true;
  const interval = profile.frequency === 'weekly' ? 7 * 86_400_000 : 86_400_000;
  return now.getTime() - last >= interval;
}

export interface RecommendationFilters {
  profileId?: number;
  status?: RecommendationStatus;
  sourceId?: string;
  minScore?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export function listRecommendations(filters: RecommendationFilters = {}): Paginated<JobRecommendation> {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.profileId) {
    conditions.push('profile_id = ?');
    params.push(filters.profileId);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.sourceId) {
    conditions.push('source_id = ?');
    params.push(filters.sourceId);
  }
  if (filters.minScore !== undefined) {
    conditions.push('score >= ?');
    params.push(filters.minScore);
  }
  if (filters.keyword) {
    conditions.push('(company_name LIKE ? OR position_title LIKE ? OR city LIKE ?)');
    const like = `%${filters.keyword}%`;
    params.push(like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM job_recommendations ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM job_recommendations ${where} ORDER BY score DESC, last_seen_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as RecommendationRow[];
  return { items: rows.map(toRecommendation), total, page, pageSize };
}

export function getRecommendation(id: number): JobRecommendation {
  const row = getDb().prepare('SELECT * FROM job_recommendations WHERE id = ?').get(id) as RecommendationRow | undefined;
  if (!row) throw AppError.notFound('岗位推荐');
  return toRecommendation(row);
}

export function updateRecommendationStatus(id: number, status: Exclude<RecommendationStatus, 'imported'>): JobRecommendation {
  getRecommendation(id);
  getDb().prepare('UPDATE job_recommendations SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  return getRecommendation(id);
}

function normalizedIdentity(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function makeSourceKey(record: RawJobRecord, explicit?: string): string {
  const supplied = explicit?.trim() || record.sourceKey?.trim();
  if (supplied) return supplied.slice(0, 300);
  let identity = '';
  if (record.jdUrl?.trim()) {
    try {
      const url = new URL(record.jdUrl.trim());
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|trk|tracking|ref)/i.test(key)) url.searchParams.delete(key);
      }
      identity = `url:${url.toString()}`;
    } catch {
      identity = `url:${record.jdUrl.trim()}`;
    }
  } else {
    identity = [record.companyName, record.positionTitle, record.city ?? record.companyCity ?? '']
      .map(normalizedIdentity)
      .join('|');
  }
  return `generated:${createHash('sha256').update(identity).digest('hex')}`;
}

function explainMatch(match: StructuredMatch): { summary: string; reasons: string[] } {
  const reasons: string[] = [];
  if (match.skillHits.length) reasons.push(`命中技能：${match.skillHits.slice(0, 6).join('、')}`);
  if (match.skillMisses.length) reasons.push(`待核对技能（JD 未命中）：${match.skillMisses.slice(0, 6).join('、')}`);
  if (match.educationReq) {
    reasons.push(match.educationMatch === false ? `学历要求可能不匹配：${match.educationReq}` : `符合学历要求：${match.educationReq}`);
  }
  if (match.cityMatch === true) reasons.push('岗位城市与简历意向一致');
  if (match.cityMatch === false) reasons.push('岗位城市与简历城市不同，请人工确认');
  if (match.titleHit) reasons.push('岗位名称与简历经历存在较高重合');
  if (!reasons.length) reasons.push('基础条件可进一步人工核对');
  const summary = `匹配度 ${match.score} 分；${reasons.slice(0, 2).join('；')}`;
  return { summary, reasons };
}

function resumeWithProfileCity(resume: Resume, profile: SearchProfile): Resume {
  const city = profile.cities[0]?.trim();
  if (!city) return resume;
  return { ...resume, basic: { ...(resume.basic ?? {}), city } };
}

interface ScoredRecord {
  sourceId: string;
  sourceKey: string;
  record: RawJobRecord;
  match: StructuredMatch;
}

function upsertRecommendation(profileId: number, item: ScoredRecord): JobRecommendation {
  const db = getDb();
  const now = nowIso();
  const { summary, reasons } = explainMatch(item.match);
  const record = item.record;
  db.prepare(
    `INSERT INTO job_recommendations
     (profile_id, source_id, source_key, company_name, company_industry, company_city, company_website,
      position_title, job_type, channel, jd_url, deadline, salary, city, jd_description,
      score, summary, reasons, status, application_id, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?, ?, ?, ?)
     ON CONFLICT(profile_id, source_id, source_key) DO UPDATE SET
       company_name = excluded.company_name,
       company_industry = excluded.company_industry,
       company_city = excluded.company_city,
       company_website = excluded.company_website,
       position_title = excluded.position_title,
       job_type = excluded.job_type,
       channel = excluded.channel,
       jd_url = excluded.jd_url,
       deadline = excluded.deadline,
       salary = excluded.salary,
       city = excluded.city,
       jd_description = excluded.jd_description,
       score = excluded.score,
       summary = excluded.summary,
       reasons = excluded.reasons,
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`,
  ).run(
    profileId,
    item.sourceId,
    item.sourceKey,
    record.companyName.trim(),
    record.companyIndustry?.trim() || null,
    record.companyCity?.trim() || null,
    record.companyWebsite?.trim() || null,
    record.positionTitle.trim(),
    record.jobType === 'intern' ? 'intern' : 'school',
    record.channel?.trim() || null,
    record.jdUrl?.trim() || null,
    record.deadline?.trim() || null,
    record.salary?.trim() || null,
    record.city?.trim() || record.companyCity?.trim() || null,
    record.jdDescription?.trim().slice(0, 10_000) || null,
    item.match.score,
    summary,
    JSON.stringify(reasons),
    now,
    now,
    now,
    now,
  );
  const row = db
    .prepare('SELECT * FROM job_recommendations WHERE profile_id = ? AND source_id = ? AND source_key = ?')
    .get(profileId, item.sourceId, item.sourceKey) as RecommendationRow;
  return toRecommendation(row);
}

export interface ManualRecommendationInput {
  profileId: number;
  sourceId?: 'linkedin-manual' | 'manual';
  sourceKey?: string;
  companyName: string;
  companyIndustry?: string;
  companyCity?: string;
  companyWebsite?: string;
  positionTitle: string;
  jobType?: 'school' | 'intern';
  channel?: string;
  jdUrl?: string;
  deadline?: string;
  salary?: string;
  city?: string;
  jdDescription?: string;
}

/** 用户粘贴 LinkedIn 或其他来源岗位；仅本地保存和匹配，不访问对应站点。 */
export function addManualRecommendation(input: ManualRecommendationInput): JobRecommendation {
  const profile = getSearchProfile(input.profileId);
  const resume = resumeWithProfileCity(getResume(profile.resumeId), profile);
  const sourceId = input.sourceId ?? 'linkedin-manual';
  const record: RawJobRecord = {
    companyName: input.companyName.trim(),
    companyIndustry: input.companyIndustry,
    companyCity: input.companyCity,
    companyWebsite: input.companyWebsite,
    positionTitle: input.positionTitle.trim(),
    jobType: input.jobType ?? profile.recruitType,
    channel: input.channel ?? (sourceId === 'linkedin-manual' ? 'LinkedIn（手动）' : '手动录入'),
    jdUrl: input.jdUrl,
    deadline: input.deadline,
    salary: input.salary,
    city: input.city,
    jdDescription: input.jdDescription,
  };
  const match = structuredMatch(resume, record.positionTitle, record.jdDescription, record.city ?? record.companyCity);
  return upsertRecommendation(profile.id, { sourceId, sourceKey: makeSourceKey(record, input.sourceKey), record, match });
}

export interface RecommendationCrawlRunner {
  (sourceId: string, params: CrawlParams): Promise<CrawlResult>;
}

export const defaultRecommendationCrawlRunner: RecommendationCrawlRunner = (sourceId, params) => crawl(sourceId, params);

/**
 * 执行画像闭环：关键词×数据源抓取、来源内去重、确定性评分、阈值过滤、持久化及可选导入。
 * runner 可注入，测试和离线环境无需触发真实网络。
 */
export async function runProfile(
  profileId: number,
  runner: RecommendationCrawlRunner = defaultRecommendationCrawlRunner,
): Promise<RecommendationRun> {
  const db = getDb();
  const profile = getSearchProfile(profileId);
  const resume = resumeWithProfileCity(getResume(profile.resumeId), profile);
  const startedAt = nowIso();
  const runInfo = db
    .prepare(
      `INSERT INTO recommendation_runs
       (profile_id, status, fetched, matched, saved, imported, error, started_at, finished_at)
       VALUES (?, 'running', 0, 0, 0, 0, NULL, ?, NULL)`,
    )
    .run(profile.id, startedAt);
  const runId = Number(runInfo.lastInsertRowid);
  let fetched = 0;
  let matched = 0;
  let saved = 0;
  let imported = 0;
  let successfulCrawls = 0;
  const crawlErrors: string[] = [];

  try {
    const unique = new Map<string, ScoredRecord>();
    const keywords = profile.keywords.slice(0, 6);
    for (const keyword of keywords) {
      for (const sourceId of profile.sourceIds.slice(0, 5)) {
        let result: CrawlResult;
        try {
          result = await runner(sourceId, {
            keyword,
            recruitType: profile.recruitType,
            maxPages: profile.maxPages,
          });
          successfulCrawls++;
        } catch (error) {
          crawlErrors.push(`${sourceId}/${keyword}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        fetched += result.records.length;
        for (const record of result.records) {
          if (!record.companyName?.trim() || !record.positionTitle?.trim()) continue;
          const actualSourceId = result.sourceId || sourceId;
          const sourceKey = makeSourceKey(record);
          const dedupeKey = `${actualSourceId}\u0000${sourceKey}`;
          if (unique.has(dedupeKey)) continue;
          const match = structuredMatch(
            resume,
            record.positionTitle,
            record.jdDescription,
            record.city ?? record.companyCity,
          );
          unique.set(dedupeKey, { sourceId: actualSourceId, sourceKey, record, match });
        }
      }
    }

    if (successfulCrawls === 0) {
      throw new Error(crawlErrors.length ? `所有岗位数据源均失败：${crawlErrors.join('；')}` : '没有可执行的岗位数据源');
    }

    for (const item of unique.values()) {
      if (item.match.score < profile.minScore) continue;
      matched++;
      let recommendation = upsertRecommendation(profile.id, item);
      saved++;
      if (profile.autoImport && recommendation.status !== 'dismissed' && recommendation.status !== 'imported') {
        const result = importRecommendation(recommendation.id);
        recommendation = result.recommendation;
        if (result.imported) imported++;
      }
    }

    const finishedAt = nowIso();
    db.prepare(
      `UPDATE recommendation_runs SET
       status = 'success', fetched = ?, matched = ?, saved = ?, imported = ?, error = ?, finished_at = ?
       WHERE id = ?`,
    ).run(
      fetched,
      matched,
      saved,
      imported,
      crawlErrors.length ? `部分抓取失败：${crawlErrors.join('；')}`.slice(0, 1000) : null,
      finishedAt,
      runId,
    );
    db.prepare('UPDATE job_search_profiles SET last_run_at = ?, updated_at = ? WHERE id = ?').run(
      finishedAt,
      finishedAt,
      profile.id,
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    const finishedAt = nowIso();
    db.prepare(
      `UPDATE recommendation_runs SET
       status = 'failed', fetched = ?, matched = ?, saved = ?, imported = ?, error = ?, finished_at = ?
       WHERE id = ?`,
    ).run(fetched, matched, saved, imported, message, finishedAt, runId);
    // 失败也记录执行时间，防止调度器每分钟重试同一个上游故障。
    db.prepare('UPDATE job_search_profiles SET last_run_at = ?, updated_at = ? WHERE id = ?').run(
      finishedAt,
      finishedAt,
      profile.id,
    );
  }

  return getRecommendationRun(runId);
}

function getRecommendationRun(id: number): RecommendationRun {
  const row = getDb().prepare('SELECT * FROM recommendation_runs WHERE id = ?').get(id) as RunRow | undefined;
  if (!row) throw AppError.notFound('推荐运行记录');
  return toRun(row);
}

export function listRecommendationRuns(filters: { profileId?: number; page?: number; pageSize?: number } = {}): Paginated<RecommendationRun> {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.profileId) {
    conditions.push('profile_id = ?');
    params.push(filters.profileId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM recommendation_runs ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM recommendation_runs ${where} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as RunRow[];
  return { items: rows.map(toRun), total, page, pageSize };
}

export interface RecommendationImportResult {
  recommendation: JobRecommendation;
  applicationId: number;
  imported: boolean;
}

/** 推荐项进入正式申请表；已有“公司+岗位”时建立关联而不重复创建。 */
export function importRecommendation(id: number): RecommendationImportResult {
  const db = getDb();
  const recommendation = getRecommendation(id);
  const profile = getSearchProfile(recommendation.profileId);
  const raw: RawJobRecord = {
    companyName: recommendation.companyName,
    companyIndustry: recommendation.companyIndustry ?? undefined,
    companyCity: recommendation.companyCity ?? recommendation.city ?? undefined,
    companyWebsite: recommendation.companyWebsite ?? undefined,
    positionTitle: recommendation.positionTitle,
    jobType: recommendation.jobType,
    channel: recommendation.channel ?? recommendation.sourceId,
    jdUrl: recommendation.jdUrl ?? undefined,
    deadline: recommendation.deadline ?? undefined,
    salary: recommendation.salary ?? undefined,
    city: recommendation.city ?? undefined,
    jdDescription: recommendation.jdDescription ?? undefined,
    status: 'WISHLIST',
  };
  const result = importRecords([raw]);
  if (result.errors.length) throw AppError.validation(`推荐岗位导入失败：${result.errors[0].message}`);
  const application = db
    .prepare(
      `SELECT a.id FROM applications a
       JOIN companies c ON c.id = a.company_id
       WHERE c.name = ? AND a.position_title = ?`,
    )
    .get(recommendation.companyName.trim(), recommendation.positionTitle.trim()) as { id: number } | undefined;
  if (!application) throw new Error('推荐岗位导入后未找到申请记录');

  const now = nowIso();
  // 已有申请可能由用户明确选择了另一份定制简历；仅为空时补充画像简历，避免覆盖用户决策。
  db.prepare('UPDATE applications SET resume_id = COALESCE(resume_id, ?), updated_at = ? WHERE id = ?').run(
    profile.resumeId,
    now,
    application.id,
  );
  db.prepare(
    `UPDATE job_recommendations SET status = 'imported', application_id = ?, updated_at = ? WHERE id = ?`,
  ).run(application.id, now, id);
  return { recommendation: getRecommendation(id), applicationId: application.id, imported: result.imported > 0 };
}

export function importRecommendationsBatch(ids: number[]): {
  imported: number;
  skipped: number;
  errors: Array<{ id: number; message: string }>;
  items: JobRecommendation[];
} {
  let imported = 0;
  let skipped = 0;
  const errors: Array<{ id: number; message: string }> = [];
  const items: JobRecommendation[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const result = importRecommendation(id);
      if (result.imported) imported++;
      else skipped++;
      items.push(result.recommendation);
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { imported, skipped, errors, items };
}

export interface LinkedInSearchPlan {
  profileId: number;
  queries: Array<{ keywords: string; location: string | null; queryText: string }>;
  notice: string;
}

/** 仅生成可复制的搜索文本，不抓取 LinkedIn、不生成自动化访问链接。 */
export function buildLinkedInSearchPlan(profileId: number): LinkedInSearchPlan {
  const profile = getSearchProfile(profileId);
  const locations: Array<string | null> = profile.cities.length ? profile.cities : [null];
  const suffix = profile.recruitType === 'intern' ? 'internship' : 'graduate';
  const queries: LinkedInSearchPlan['queries'] = [];
  for (const keywords of profile.keywords.slice(0, 6)) {
    for (const location of locations.slice(0, 3)) {
      queries.push({
        keywords,
        location,
        queryText: [`"${keywords}"`, suffix, location].filter(Boolean).join(' '),
      });
    }
  }
  return {
    profileId,
    queries,
    notice: '请复制搜索文本并由你本人在 LinkedIn 内搜索、核对和提交；FindJob 不抓取或自动操作 LinkedIn。',
  };
}
