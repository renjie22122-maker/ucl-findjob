import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/connection.js';
import { auditTimer, clearAudits, listAudits, recordAudit } from './audit.service.js';

describe('出站调用审计', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec('DELETE FROM audit_logs;');
  });

  it('记录与查询', () => {
    recordAudit({ kind: 'crawl', target: 'https://nowpick.nowcoder.com/u/job/search', detail: '关键词=后端', status: 'success', result: '抓取到 20 条', durationMs: 1200 });
    recordAudit({ kind: 'llm', target: 'https://api.deepseek.com/chat/completions', detail: '主题：面试邀请', status: 'failed', error: 'HTTP 401' });

    const all = listAudits({});
    expect(all.total).toBe(2);
    expect(all.items[0].kind).toBe('llm'); // 倒序
    expect(all.items[0].error).toBe('HTTP 401');

    const crawls = listAudits({ kind: 'crawl' });
    expect(crawls.total).toBe(1);
    expect(crawls.items[0].result).toBe('抓取到 20 条');
  });

  it('auditTimer 自动记录成功/失败与耗时', () => {
    const t1 = auditTimer({ kind: 'imap', target: 'imap.qq.com:993', detail: '测试连接' });
    t1.ok('连接成功');
    const t2 = auditTimer({ kind: 'oauth2', target: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', detail: '申请设备码' });
    t2.fail('AADSTS700038');

    const items = listAudits({}).items;
    expect(items).toHaveLength(2);
    expect(items[0].status).toBe('failed');
    expect(items[1].status).toBe('success');
    expect(items[1].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('清空与裁剪（保留最近 2000 条）', () => {
    clearAudits();
    expect(listAudits({}).total).toBe(0);
  });
});
