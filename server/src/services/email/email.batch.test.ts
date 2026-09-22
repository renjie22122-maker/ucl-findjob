import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../db/connection.js';
import { createCompany } from '../companies.service.js';
import { createApplication } from '../applications.service.js';
import { applyEmailBatch } from './email.service.js';
import { nowIso } from '../../utils/time.js';

describe('邮件批量自动应用（高置信度）', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec(
      'DELETE FROM email_items; DELETE FROM applications; DELETE FROM companies; DELETE FROM timeline_events; DELETE FROM reminders;',
    );
  });

  function seedPending(subject: string, extracted: unknown): number {
    const info = getDb()
      .prepare(
        `INSERT INTO email_items (message_id, subject, sender, received_at, snippet, extracted, status, application_id, created_at, applied_at)
         VALUES (?, ?, 'hr@corp.com', ?, 'snippet', ?, 'pending', NULL, ?, NULL)`,
      )
      .run(`msg:${subject}:${Math.random()}`, subject, nowIso(), JSON.stringify(extracted), nowIso());
    return Number(info.lastInsertRowid);
  }

  it('只应用置信度 ≥ 阈值的邮件，并生成时间线笔记', () => {
    const company = createCompany({ name: '字节跳动' });
    const app = createApplication({ companyId: company.id, positionTitle: '后端开发工程师' });

    seedPending('高置信度面试邀请', { company: '字节跳动', eventType: 'interview', eventTime: null, positionTitle: '后端开发工程师', summary: '一面', confidence: 0.92 });
    seedPending('低置信度规则提取', { company: '美团', eventType: 'interview', eventTime: null, positionTitle: null, summary: '规则识别', confidence: 0.4 });
    seedPending('无法提取', null);

    const result = applyEmailBatch(0.8);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].ok).toBe(true);

    // 高置信度邮件生成了时间线笔记
    const events = getDb()
      .prepare('SELECT * FROM timeline_events WHERE application_id = ? AND event_type = ?')
      .all(app.id, 'note') as { title: string }[];
    expect(events.some((e) => e.title.includes('邮件：面试'))).toBe(true);

    // 状态流转确认：邮件仅记笔记，不改状态机（ADR-7）
    const status = (getDb().prepare('SELECT status FROM applications WHERE id = ?').get(app.id) as { status: string }).status;
    expect(status).toBe('WISHLIST');
  });

  it('阈值设为 0 时应用全部有提取结果的邮件', () => {
    seedPending('A', { company: null, eventType: null, eventTime: null, positionTitle: null, summary: 's', confidence: 0.3 });
    seedPending('B', null);
    const result = applyEmailBatch(0);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
