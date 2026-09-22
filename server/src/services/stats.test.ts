import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeDate, normalizeStatus, importRecords } from './import.service.js';
import { getOverview, getTrends } from './stats.service.js';
import { createCompany } from './companies.service.js';
import { createApplication, transitionApplication } from './applications.service.js';
import { closeDb, getDb } from '../db/connection.js';
import { localIso, nowIso } from '../utils/time.js';

describe('导入规范化', () => {
  it('中文状态名映射为枚举', () => {
    expect(normalizeStatus('已投递')).toBe('APPLIED');
    expect(normalizeStatus('一面')).toBe('INTERVIEW_1');
    expect(normalizeStatus('APPLIED')).toBe('APPLIED');
    expect(normalizeStatus(undefined)).toBe('WISHLIST');
    expect(normalizeStatus('不存在的状态')).toBe('WISHLIST');
  });

  it('日期规范化', () => {
    expect(normalizeDate('2025-09-01')).toBe('2025-09-01');
    expect(normalizeDate('2025-09-01T10:00:00')).toBe('2025-09-01');
    expect(normalizeDate('')).toBeUndefined();
    expect(normalizeDate('not-a-date')).toBeUndefined();
  });
});

describe('统计口径（事件溯源）', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec('DELETE FROM applications; DELETE FROM companies; DELETE FROM timeline_events; DELETE FROM reminders;');
  });

  it('漏斗按时间线事件推导：投递→面试→Offer', () => {
    const company = createCompany({ name: '测试公司' });

    const a1 = createApplication({ companyId: company.id, positionTitle: '后端', status: 'APPLIED' });
    transitionApplication(a1.id, { toStatus: 'INTERVIEW_1' });
    transitionApplication(a1.id, { toStatus: 'OFFER' });
    transitionApplication(a1.id, { toStatus: 'SIGNED' });

    const a2 = createApplication({ companyId: company.id, positionTitle: '前端', status: 'APPLIED' });
    transitionApplication(a2.id, { toStatus: 'REJECTED' });

    createApplication({ companyId: company.id, positionTitle: '待投递', status: 'WISHLIST' });

    const overview = getOverview();
    expect(overview.total).toBe(3);
    expect(overview.active).toBe(1);
    expect(overview.offers).toBe(1);
    expect(overview.signed).toBe(1);
    expect(overview.rejected).toBe(1);
    expect(overview.funnel).toEqual({ applied: 2, interviewed: 1, offer: 1 });
  });

  it('趋势按天聚合状态事件', () => {
    const company = createCompany({ name: '趋势公司' });
    const a = createApplication({ companyId: company.id, positionTitle: '岗', status: 'WISHLIST' });
    transitionApplication(a.id, { toStatus: 'APPLIED', occurredAt: nowIso() });

    const trends = getTrends(7);
    expect(trends).toHaveLength(7);
    const today = trends[trends.length - 1];
    expect(today.date).toBe(nowIso().slice(0, 10));
    expect(today.applied).toBe(1);
  });

  it('近 7 天新投递按首次离开待投递状态计数', () => {
    const company = createCompany({ name: '近期开启投递公司' });
    createApplication({ companyId: company.id, positionTitle: '仍在收藏', status: 'WISHLIST' });
    createApplication({ companyId: company.id, positionTitle: '本周投递', status: 'APPLIED' });

    const old = createApplication({ companyId: company.id, positionTitle: '上周投递', status: 'WISHLIST' });
    transitionApplication(old.id, {
      toStatus: 'APPLIED',
      occurredAt: localIso(new Date(Date.now() - 8 * 86400_000)),
    });
    transitionApplication(old.id, { toStatus: 'WRITTEN_TEST', occurredAt: nowIso() });

    expect(getOverview().recentApplied7d).toBe(1);
  });

  it('批量导入去重：同公司同岗位只导入一次', () => {
    const result = importRecords([
      { companyName: 'A公司', positionTitle: '岗位X', status: '已投递' },
      { companyName: 'A公司', positionTitle: '岗位X', status: '已投递' },
      { companyName: 'A公司', positionTitle: '岗位Y' },
    ]);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(0);

    // 再次导入同样内容 → 全部跳过
    const again = importRecords([{ companyName: 'A公司', positionTitle: '岗位X' }]);
    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(1);
  });
});
