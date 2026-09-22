import { describe, expect, it } from 'vitest';
import { parseSearchResponse } from './nowcoder.adapter.js';
import type { SearchResponse } from './nowcoder.adapter.js';

const FIXTURE: SearchResponse = {
  code: 0,
  msg: 'OK',
  data: {
    totalCount: 2,
    totalPage: 1,
    currentPage: 1,
    datas: [
      {
        id: 461201,
        jobName: '【27届秋招】SLG游戏海外运营',
        recruitType: 1,
        jobCity: '北京',
        salaryType: 2,
        salaryMin: 13,
        salaryMax: 30,
        salaryMonth: 14,
        salaryShow: null,
        deliverEnd: 1798646400000,
        recommendInternCompany: { companyName: '完美世界' },
      },
      {
        id: 463896,
        jobName: '机器人视觉算法实习生',
        recruitType: 2,
        jobCity: '佛山',
        salaryType: 2,
        salaryMin: 3,
        salaryMax: 5,
        salaryMonth: 12,
        salaryShow: null,
        deliverEnd: 1853675201000,
        recommendInternCompany: null,
        user: { identity: [{ companyName: '广东毕方智控科技有限公司' }] },
      },
      {
        id: 462162,
        jobName: '测试工程师-成都',
        recruitType: 1,
        jobCity: '成都',
        salaryType: 2,
        salaryMin: 12000,
        salaryMax: 14000,
        salaryMonth: 12,
        salaryShow: null,
        deliverEnd: 1000000, // 已过期，不应输出 deadline
        recommendInternCompany: { companyName: '电科金仓' },
      },
    ],
  },
};

describe('牛客网搜索接口解析', () => {
  it('解析校招职位：公司/岗位/城市/薪资/JD链接/截止日期', () => {
    const records = parseSearchResponse(FIXTURE);
    expect(records).toHaveLength(3);

    const first = records[0];
    expect(first.companyName).toBe('完美世界');
    expect(first.positionTitle).toBe('【27届秋招】SLG游戏海外运营');
    expect(first.jobType).toBe('school');
    expect(first.city).toBe('北京');
    expect(first.salary).toBe('13-30K·14薪');
    expect(first.jdUrl).toBe('https://www.nowcoder.com/job/detail/461201');
    expect(first.sourceKey).toBe('nowcoder:461201');
    expect(first.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.channel).toBe('牛客网');
  });

  it('实习职位映射 intern，公司可从 identity 兜底', () => {
    const second = parseSearchResponse(FIXTURE)[1];
    expect(second.jobType).toBe('intern');
    expect(second.companyName).toBe('广东毕方智控科技有限公司');
    expect(second.salary).toBe('3-5K');
  });

  it('月薪元值自动换算为 K，过期截止日期被丢弃', () => {
    const third = parseSearchResponse(FIXTURE)[2];
    expect(third.salary).toBe('12-14K');
    expect(third.deadline).toBeUndefined();
  });

  it('非 0 code 返回空数组', () => {
    expect(parseSearchResponse({ code: 500, msg: 'err' })).toEqual([]);
  });
});
