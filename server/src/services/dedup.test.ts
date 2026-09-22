import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/connection.js';
import { createCompany } from './companies.service.js';
import { createApplication, updateApplication } from './applications.service.js';
import { createResume } from './resumes.service.js';
import { importRecords } from './import.service.js';
import { applyEmailBatch } from './email/email.service.js';
import { AppError } from '../middleware/error.js';
import { nowIso } from '../utils/time.js';

describe('三路数据源一致性（跨路径去重）', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec(
      'DELETE FROM email_items; DELETE FROM applications; DELETE FROM companies; DELETE FROM timeline_events; DELETE FROM reminders; DELETE FROM resumes;',
    );
  });

  it('爬虫导入后再手动录入同公司同岗位 → 409 拒绝重复创建', () => {
    importRecords([{ companyName: '字节跳动', positionTitle: '后端开发工程师', status: '已投递' }]);

    const company = getDb().prepare("SELECT * FROM companies WHERE name = '字节跳动'").get() as { id: number };
    expect(() =>
      createApplication({ companyId: company.id, positionTitle: '后端开发工程师' }),
    ).toThrowError(AppError);

    try {
      createApplication({ companyId: company.id, positionTitle: '后端开发工程师' });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(409);
      expect((err as AppError).code).toBe('CONFLICT');
      expect((err as AppError).message).toContain('无需重复创建');
    }

    // 库里仍只有 1 条
    const count = (getDb().prepare('SELECT COUNT(*) AS c FROM applications').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('手动录入后爬虫再导入同公司同岗位 → 自动跳过', () => {
    const company = createCompany({ name: '腾讯' });
    createApplication({ companyId: company.id, positionTitle: '前端开发' });

    const result = importRecords([{ companyName: '腾讯', positionTitle: '前端开发', status: '已投递' }]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM applications').get() as { c: number }).c).toBe(1);
  });

  it('编辑记录不能绕过去重约束', () => {
    const company = createCompany({ name: '阿里巴巴' });
    const first = createApplication({ companyId: company.id, positionTitle: '后端开发' });
    const second = createApplication({ companyId: company.id, positionTitle: '前端开发' });

    expect(() => updateApplication(second.id, { positionTitle: first.positionTitle })).toThrowError(AppError);
    expect(getDb().prepare('SELECT position_title FROM applications WHERE id = ?').get(second.id)).toMatchObject({
      position_title: '前端开发',
    });
  });

  it('编辑时显式 null 可以清空申请的可空字段', () => {
    const company = createCompany({ name: '网易' });
    const resume = createResume({ name: '通用简历' });
    const application = createApplication({
      companyId: company.id,
      positionTitle: '服务端开发',
      channel: '内推',
      jdUrl: 'https://jobs.example.com/1',
      deadline: '2026-10-01',
      appliedAt: '2026-09-01',
      note: '待跟进',
      resumeId: resume.id,
      jdDescription: '岗位描述',
    });

    const updated = updateApplication(application.id, {
      channel: null,
      jdUrl: null,
      deadline: null,
      appliedAt: null,
      note: null,
      resumeId: null,
      jdDescription: null,
    });
    expect(updated).toMatchObject({
      channel: null,
      jdUrl: null,
      deadline: null,
      appliedAt: null,
      note: null,
      resumeId: null,
      jdDescription: null,
    });
  });

  it('邮件应用时，同事件提醒已存在则不重复创建', () => {
    const company = createCompany({ name: '美团' });
    const app = createApplication({ companyId: company.id, positionTitle: '后端' });

    const eventTime = nowIso();
    // 手动已有相同提醒
    getDb()
      .prepare(
        `INSERT INTO reminders (application_id, type, title, scheduled_at, done, done_at, created_at)
         VALUES (?, 'interview', '美团 一面', ?, 0, NULL, ?)`,
      )
      .run(app.id, eventTime, nowIso());

    // 邮件提取结果 eventTime 相同
    getDb()
      .prepare(
        `INSERT INTO email_items (message_id, subject, sender, received_at, snippet, extracted, status, application_id, created_at, applied_at)
         VALUES ('dedup-test', '面试邀请', 'hr@meituan.com', ?, '', ?, 'pending', NULL, ?, NULL)`,
      )
      .run(nowIso(), JSON.stringify({ company: '美团', eventType: 'interview', eventTime, positionTitle: '后端', summary: '一面', confidence: 0.9 }), nowIso());

    const result = applyEmailBatch(0.8);
    expect(result.applied).toBe(1);
    expect(result.results[0].ok).toBe(true);

    const reminders = getDb().prepare('SELECT COUNT(*) AS c FROM reminders').get() as { c: number };
    expect(reminders.c).toBe(1); // 未重复创建
  });
});
