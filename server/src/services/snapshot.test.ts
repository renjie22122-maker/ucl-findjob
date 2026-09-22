import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/connection.js';
import { createApplication } from './applications.service.js';
import { createCompany } from './companies.service.js';
import { buildSnapshot, buildSnapshotHtml, type SnapshotData } from './snapshot.service.js';

describe('公开快照', () => {
  beforeEach(() => {
    getDb().exec('DELETE FROM reminders; DELETE FROM timeline_events; DELETE FROM applications; DELETE FROM companies;');
  });

  it('仅导出公开字段，不泄露备注、简历关联或 JD 全文', () => {
    const company = createCompany({ name: '测试公司', note: '公司私密备注' });
    createApplication({
      companyId: company.id,
      positionTitle: '后端工程师',
      note: '投递私密备注',
      jdDescription: '不应公开的 JD 全文',
    });

    const snapshot = buildSnapshot();
    expect(snapshot.companies).toHaveLength(1);
    expect(snapshot.applications).toHaveLength(1);
    expect(snapshot.companies[0]).not.toHaveProperty('note');
    expect(snapshot.applications[0]).not.toHaveProperty('note');
    expect(snapshot.applications[0]).not.toHaveProperty('resume_id');
    expect(snapshot.applications[0]).not.toHaveProperty('jd_description');
  });

  it('转义用户文本并拒绝危险链接协议', () => {
    const snapshot: SnapshotData = {
      generatedAt: '2026-01-01T00:00:00',
      stats: { total: 1, active: 1, pendingReminders: 0 },
      companies: [],
      applications: [
        {
          company_name: '<script>alert(1)</script>',
          position_title: '工程师" onclick="alert(2)',
          statusLabel: '待投递',
          priority: 'HIGH',
          applied_at: '',
          deadline: '',
          jd_url: 'javascript:alert(3)',
        },
      ],
    };

    const html = buildSnapshotHtml(snapshot);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('工程师&quot; onclick=&quot;alert(2)');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onclick="alert(2)"');
  });

  it('保留安全的 HTTPS JD 链接并添加 opener 隔离', () => {
    const snapshot: SnapshotData = {
      generatedAt: '2026-01-01T00:00:00',
      stats: { total: 1, active: 1, pendingReminders: 0 },
      companies: [],
      applications: [
        {
          company_name: '测试公司',
          position_title: '工程师',
          statusLabel: '待投递',
          priority: 'MEDIUM',
          applied_at: '',
          deadline: '',
          jd_url: 'https://example.com/jobs?id=1&from=findjob',
        },
      ],
    };

    const html = buildSnapshotHtml(snapshot);
    expect(html).toContain('href="https://example.com/jobs?id=1&amp;from=findjob"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
