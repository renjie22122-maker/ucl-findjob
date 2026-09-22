import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/connection.js';
import {
  buildActionList,
  compareOffers,
  deadlineUrgency,
  extractEducationRequirement,
  matchAllApplications,
  matchResumeBatch,
  parseInterviewRecord,
  resumeDegreeRank,
  resumeToText,
  structuredMatch,
} from './ai.service.js';
import { createResume, type Resume } from './resumes.service.js';
import { createCompany } from './companies.service.js';
import { createApplication } from './applications.service.js';

function makeResume(overrides: Partial<Resume>): Resume {
  return {
    id: 1,
    name: '测试',
    targetRole: '后端开发工程师',
    basic: { name: '张三', city: '北京' },
    education: [{ school: '某大学', degree: '硕士', major: '计算机' }],
    experience: [],
    projects: [],
    skills: ['Java', 'Go', 'MySQL', 'Redis'],
    content: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('结构化岗位匹配（学历/技能/城市）', () => {
  it('简历文本包含目标岗位，并参与岗位名匹配', () => {
    const resume = makeResume({ targetRole: '数据分析师', skills: [] });
    expect(resumeToText(resume)).toContain('求职意向：数据分析师');
    expect(structuredMatch(resume, '数据分析师', null).titleHit).toBe(true);
  });

  it('提取 JD 学历要求', () => {
    expect(extractEducationRequirement('要求硕士及以上学历')).toBe('硕士');
    expect(extractEducationRequirement('本科及以上，计算机相关专业')).toBe('本科');
    expect(extractEducationRequirement('学历不限')).toBe('学历不限');
    expect(extractEducationRequirement('欢迎加入我们')).toBeNull();
  });

  it('学历等级：硕士简历满足本科/硕士要求，不满足博士', () => {
    const resume = makeResume({});
    expect(resumeDegreeRank(resume)).toBe(3);
    expect(structuredMatch(resume, '后端开发', '本科及以上').educationMatch).toBe(true);
    expect(structuredMatch(resume, '后端开发', '博士学历').educationMatch).toBe(false);
    expect(structuredMatch(resume, '后端开发', null).educationMatch).toBeNull();
  });

  it('技能命中与计分：命中越多分越高，学历硬伤封顶 40', () => {
    const good = structuredMatch(resumeBase(), 'Java 后端开发工程师', '熟悉 Java、Redis、MySQL，要求硕士', '北京');
    expect(good.skillHits.sort()).toEqual(['Java', 'MySQL', 'Redis']);
    expect(good.skillMisses).toEqual([]); // 简历额外掌握 Go，不应被误报为 JD 技能缺口
    expect(good.cityMatch).toBe(true);
    expect(good.score).toBeGreaterThanOrEqual(80);

    const badEdu = structuredMatch(makeResume({ education: [{ school: 'x', degree: '本科' }] }), '后端', '要求博士学历', null);
    expect(badEdu.educationMatch).toBe(false);
    expect(badEdu.score).toBeLessThanOrEqual(40);
  });

  it('技能差距只报告 JD 明确要求且简历未体现的技术词', () => {
    const result = structuredMatch(
      makeResume({ skills: ['Java'] }),
      '后端开发工程师',
      '负责团队协作与沟通，熟悉 Java、Python，了解 Kubernetes',
    );

    expect(result.skillHits).toEqual(['Java']);
    expect(result.skillMisses).toEqual(['Python', 'Kubernetes']);
    expect(result.skillMisses).not.toContain('团队协作');
    expect(result.skillMisses).not.toContain('沟通');
  });

  it('批量规则匹配使用岗位城市，同等岗位优先简历所在城市', async () => {
    const results = await matchResumeBatch(makeResume({ skills: ['Java'] }), [
      { sourceKey: 'sh', companyName: '上海公司', positionTitle: 'Java 后端开发工程师', jdDescription: '熟悉 Java', city: '上海' },
      { sourceKey: 'bj', companyName: '北京公司', positionTitle: 'Java 后端开发工程师', jdDescription: '熟悉 Java', city: '北京' },
    ]);

    expect(results[0].sourceKey).toBe('bj');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].summary).toContain('城市匹配');
    expect(results[1].summary).toContain('城市不匹配');
  });
});

function resumeBase() {
  return makeResume({});
}

describe('全量岗位匹配筛选', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec('DELETE FROM resumes; DELETE FROM applications; DELETE FROM companies;');
  });

  it('全库岗位按简历匹配排序', () => {
    const resume = createResume({
      name: '简历',
      basic: { city: '北京' },
      education: [{ school: 'x', degree: '硕士' }],
      skills: ['Java', 'Go'],
    });
    const c1 = createCompany({ name: 'A公司', city: '北京' });
    const c2 = createCompany({ name: 'B公司', city: '上海' });
    createApplication({ companyId: c1.id, positionTitle: 'Java 后端开发', jdDescription: '熟悉 Java，要求硕士', status: 'WISHLIST' });
    createApplication({ companyId: c2.id, positionTitle: '算法工程师', jdDescription: '熟悉 Python，要求博士', status: 'WISHLIST' });

    const items = matchAllApplications(resume);
    expect(items).toHaveLength(2);
    expect(items[0].companyName).toBe('A公司');
    expect(items[0].score).toBeGreaterThan(items[1].score);
    expect(items[0].skillHits).toContain('Java');
    expect(items[1].educationMatch).toBe(false);
    expect(items[1].cityMatch).toBe(false);
  });

  it('投递清单：只包含待投递岗位，并按匹配度×紧急度排序', () => {
    const resume = createResume({
      name: '简历',
      basic: { city: '北京' },
      education: [{ school: 'x', degree: '硕士' }],
      skills: ['Java'],
    });
    const c1 = createCompany({ name: 'A公司', city: '北京' });
    const c2 = createCompany({ name: 'B公司', city: '北京' });
    const nearDeadline = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    createApplication({ companyId: c1.id, positionTitle: 'Java 后端', jdDescription: '熟悉 Java', deadline: nearDeadline, status: 'WISHLIST' });
    createApplication({ companyId: c2.id, positionTitle: 'Java 后端', jdDescription: '熟悉 Java', status: 'SIGNED' });
    createApplication({ companyId: c2.id, positionTitle: 'Java 服务端', jdDescription: '熟悉 Java', status: 'APPLIED' });
    createApplication({ companyId: c2.id, positionTitle: 'Java 平台开发', jdDescription: '熟悉 Java', status: 'INTERVIEW_1' });

    const list = buildActionList(resume, 10);
    expect(list).toHaveLength(1);
    expect(list.every((item) => item.status === 'WISHLIST')).toBe(true);
    expect(list[0].companyName).toBe('A公司');
    expect(list[0].urgency).toBe(30);
    expect(list[0].actionScore).toBeGreaterThanOrEqual(list[0].score);
  });

  it('截止日期紧急度分级', () => {
    const now = new Date();
    const iso = (days: number) => new Date(now.getTime() + days * 86400_000).toISOString();
    expect(deadlineUrgency(iso(3))).toBe(30);
    expect(deadlineUrgency(iso(20))).toBe(20);
    expect(deadlineUrgency(iso(60))).toBe(0);
    expect(deadlineUrgency(null)).toBe(0);
    expect(deadlineUrgency(iso(-5))).toBe(0); // 已过期
  });

  it('面试记录解析规则降级（未配 LLM）', async () => {
    const r = await parseInterviewRecord('今天参加了HR面试，聊了职业规划');
    expect(r.ruleBased).toBe(true);
    expect(r.round).toBe('HR面');
  });

  it('Offer 对比规则降级返回模板', async () => {
    const r = await compareOffers([
      { company: 'A', positionTitle: '后端', note: null },
      { company: 'B', positionTitle: '前端', note: null },
    ]);
    expect(r.ruleBased).toBe(true);
    expect(r.comparison).toHaveLength(2);
    expect(r.recommendation).toContain('未配置 LLM');
  });
});
