import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawJobRecord } from '../domain/types.js';
import { closeDb, getDb } from '../db/connection.js';
import { listApplications } from './applications.service.js';
import { createApplication } from './applications.service.js';
import { createCompany } from './companies.service.js';
import { createResume } from './resumes.service.js';
import {
  addManualRecommendation,
  buildLinkedInSearchPlan,
  createSearchProfile,
  deleteSearchProfile,
  deriveSearchProfile,
  getSearchProfile,
  importRecommendation,
  importRecommendationsBatch,
  isProfileDue,
  listRecommendationRuns,
  listRecommendations,
  listSearchProfiles,
  runProfile,
  updateRecommendationStatus,
  updateSearchProfile,
  type RecommendationCrawlRunner,
  type SearchProfile,
} from './recommendations.service.js';

function resetDb(): void {
  closeDb();
  const db = getDb();
  db.exec(`
    DELETE FROM job_recommendations;
    DELETE FROM recommendation_runs;
    DELETE FROM job_search_profiles;
    DELETE FROM timeline_events;
    DELETE FROM applications;
    DELETE FROM companies;
    DELETE FROM resumes;
  `);
}

function makeResume() {
  return createResume({
    name: '后端简历',
    targetRole: 'Backend Developer',
    basic: { name: 'Test', city: 'Cambridge' },
    education: [{ school: 'UCL', degree: '本科' }],
    skills: ['Java'],
    content: 'Backend Developer Java distributed systems',
  });
}

function makeProfile(overrides: Partial<Parameters<typeof createSearchProfile>[0]> = {}) {
  const resume = makeResume();
  return createSearchProfile({
    resumeId: resume.id,
    name: '后端校招',
    keywords: ['Backend Developer', 'Backend Developer Java'],
    cities: ['London'],
    sourceIds: ['nowcoder'],
    minScore: 60,
    ...overrides,
  });
}

const matchingJob: RawJobRecord = {
  companyName: 'Acme',
  positionTitle: 'Java Backend Developer',
  city: 'London',
  jdDescription: '要求本科，熟悉 Java 与分布式系统',
  jdUrl: 'https://jobs.example.com/1?utm_source=test',
  sourceKey: 'acme-backend-1',
  channel: '测试源',
};

const lowScoreJob: RawJobRecord = {
  companyName: 'Sales Co',
  positionTitle: 'Sales Representative',
  city: 'Manchester',
  jdDescription: '客户销售与商务拓展',
  sourceKey: 'sales-1',
};

describe('简历驱动的搜索画像', () => {
  beforeEach(resetDb);

  it('从 targetRole、技能组合和城市稳定派生画像，空关键词使用派生值', () => {
    const resume = makeResume();
    const derived = deriveSearchProfile(resume);
    expect(derived).toEqual({
      keywords: ['Backend Developer', 'Backend Developer Java'],
      cities: ['Cambridge'],
    });
    expect(derived.keywords).not.toContain('Java');

    const profile = createSearchProfile({ resumeId: resume.id, name: '自动画像', keywords: [] });
    expect(profile.keywords).toEqual(derived.keywords);
    expect(profile.cities).toEqual(['Cambridge']);
    expect(profile.sourceIds).toEqual(['nowcoder']);
    expect(listSearchProfiles()).toHaveLength(1);

    const updated = updateSearchProfile(profile.id, { keywords: [], cities: ['London'], autoImport: true });
    expect(updated.keywords).toEqual(derived.keywords);
    expect(updated.cities).toEqual(['London']);
    expect(updated.autoImport).toBe(1);

    deleteSearchProfile(profile.id);
    expect(listSearchProfiles()).toEqual([]);
  });

  it('仅启用的 daily/weekly 画像到期，manual 永不自动运行', () => {
    const base: SearchProfile = {
      id: 1,
      resumeId: 1,
      name: 'x',
      keywords: ['Backend'],
      cities: [],
      sourceIds: ['nowcoder'],
      recruitType: 'school',
      minScore: 60,
      maxPages: 1,
      frequency: 'daily',
      enabled: 1,
      autoImport: 0,
      lastRunAt: null,
      createdAt: '2026-01-01T00:00:00',
      updatedAt: '2026-01-01T00:00:00',
    };
    const now = new Date('2026-02-08T12:00:00Z');
    expect(isProfileDue(base, now)).toBe(true);
    expect(isProfileDue({ ...base, frequency: 'manual' }, now)).toBe(false);
    expect(isProfileDue({ ...base, enabled: 0 }, now)).toBe(false);
    expect(isProfileDue({ ...base, lastRunAt: '2026-02-07T13:00:00Z' }, now)).toBe(false);
    expect(isProfileDue({ ...base, lastRunAt: '2026-02-07T11:00:00Z' }, now)).toBe(true);
    expect(isProfileDue({ ...base, frequency: 'weekly', lastRunAt: '2026-02-02T12:00:00Z' }, now)).toBe(false);
    expect(isProfileDue({ ...base, frequency: 'weekly', lastRunAt: '2026-02-01T12:00:00Z' }, now)).toBe(true);
  });
});

describe('画像执行、去重、评分和容错', () => {
  beforeEach(resetDb);

  it('注入抓取器后按阈值过滤、跨关键词去重，并使用画像城市评分', async () => {
    const profile = makeProfile();
    const runner = vi.fn<RecommendationCrawlRunner>(async (sourceId) => ({
      sourceId,
      count: 2,
      records: [matchingJob, lowScoreJob],
    }));

    const run = await runProfile(profile.id, runner);
    expect(run.status).toBe('success');
    expect(run.fetched).toBe(4);
    expect(run.matched).toBe(1);
    expect(run.saved).toBe(1);
    expect(runner).toHaveBeenCalledTimes(2);

    const result = listRecommendations({ profileId: profile.id });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ companyName: 'Acme', sourceId: 'nowcoder', status: 'new' });
    expect(result.items[0].score).toBeGreaterThanOrEqual(60);
    expect(result.items[0].reasons).toContain('岗位城市与简历意向一致');

    const firstSeen = result.items[0].firstSeenAt;
    updateRecommendationStatus(result.items[0].id, 'saved');
    const rerun = await runProfile(profile.id, runner);
    expect(rerun.status).toBe('success');
    expect(listRecommendations({ profileId: profile.id }).total).toBe(1);
    expect(listRecommendations({ profileId: profile.id }).items[0]).toMatchObject({ status: 'saved', firstSeenAt: firstSeen });
  });

  it('单个关键词失败时继续；全部失败时留下 failed 运行记录且不抛出', async () => {
    const profile = makeProfile();
    let calls = 0;
    const partialRunner: RecommendationCrawlRunner = async (sourceId) => {
      calls++;
      if (calls === 1) throw new Error('temporary upstream error');
      return { sourceId, count: 1, records: [matchingJob] };
    };
    const partial = await runProfile(profile.id, partialRunner);
    expect(partial.status).toBe('success');
    expect(partial.error).toContain('部分抓取失败');
    expect(partial.saved).toBe(1);

    const failed = await runProfile(profile.id, async () => {
      throw new Error('offline');
    });
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('所有岗位数据源均失败');
    expect(getSearchProfile(profile.id).lastRunAt).not.toBeNull();
    expect(listRecommendationRuns({ profileId: profile.id }).total).toBe(2);
  });

  it('autoImport 将高分推荐关联到画像简历并进入正式申请', async () => {
    const profile = makeProfile({ autoImport: true, keywords: ['Backend Developer'] });
    const run = await runProfile(profile.id, async (sourceId) => ({ sourceId, count: 1, records: [matchingJob] }));
    expect(run).toMatchObject({ status: 'success', imported: 1 });
    const recommendation = listRecommendations({ profileId: profile.id }).items[0];
    expect(recommendation.status).toBe('imported');
    expect(recommendation.applicationId).toBeTypeOf('number');
    expect(listApplications().items[0]).toMatchObject({ resumeId: profile.resumeId, status: 'WISHLIST' });
  });
});

describe('人工 LinkedIn 岗位与导入', () => {
  beforeEach(resetDb);

  it('只保存用户提供的岗位并评分，不请求外网；可单条及批量导入', () => {
    const profile = makeProfile();
    const recommendation = addManualRecommendation({
      profileId: profile.id,
      companyName: 'Linked Co',
      positionTitle: 'Java Backend Developer',
      city: 'London',
      jdUrl: 'https://www.linkedin.com/jobs/view/123?trk=test',
      jdDescription: '本科，Java 后端开发',
    });
    expect(recommendation).toMatchObject({ sourceId: 'linkedin-manual', status: 'new' });
    expect(recommendation.score).toBeGreaterThanOrEqual(60);

    expect(updateRecommendationStatus(recommendation.id, 'saved').status).toBe('saved');
    const imported = importRecommendation(recommendation.id);
    expect(imported).toMatchObject({ imported: true, applicationId: expect.any(Number) });
    expect(imported.recommendation.status).toBe('imported');

    const again = importRecommendation(recommendation.id);
    expect(again.imported).toBe(false);
    const batch = importRecommendationsBatch([recommendation.id, recommendation.id, 999_999]);
    expect(batch).toMatchObject({ imported: 0, skipped: 1 });
    expect(batch.errors).toEqual([{ id: 999_999, message: '岗位推荐 不存在' }]);
    expect(listApplications().total).toBe(1);
  });

  it('LinkedIn 方案仅返回搜索文本，不包含抓取或深链', () => {
    const profile = makeProfile();
    const plan = buildLinkedInSearchPlan(profile.id);
    expect(plan.profileId).toBe(profile.id);
    expect(plan.queries).toHaveLength(2);
    expect(plan.queries[0]).toMatchObject({ keywords: 'Backend Developer', location: 'London' });
    expect(plan.queries[0].queryText).toContain('graduate');
    expect(plan.queries[0].queryText).not.toMatch(/^https?:/);
    expect(plan.notice).toContain('不抓取或自动操作 LinkedIn');
  });

  it('关联已有申请时不覆盖用户已经选择的简历', () => {
    const profile = makeProfile();
    const selectedResume = createResume({ name: '岗位定制简历', targetRole: 'Java Backend Developer' });
    const company = createCompany({ name: 'Existing Co' });
    const application = createApplication({
      companyId: company.id,
      positionTitle: 'Java Backend Developer',
      resumeId: selectedResume.id,
    });
    const recommendation = addManualRecommendation({
      profileId: profile.id,
      sourceId: 'manual',
      companyName: company.name,
      positionTitle: application.positionTitle,
      city: 'London',
      jdDescription: 'Java backend',
    });

    const result = importRecommendation(recommendation.id);
    expect(result.imported).toBe(false);
    expect(listApplications().items[0].resumeId).toBe(selectedResume.id);
  });
});
