import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { closeDb, getDb } from '../db/connection.js';
import { importRecords } from '../services/import.service.js';

describe('导入/导出 API', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  beforeEach(() => {
    closeDb();
    getDb();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    closeDb();
  });

  it('批量记录导入保留 JD 全文，并拒绝超过上限的描述', async () => {
    const jdDescription = '负责高并发交易系统，要求熟悉 TypeScript、Redis 和消息队列。';
    const response = await fetch(`${baseUrl}/import/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ companyName: 'JD 测试公司', positionTitle: '后端工程师', jdDescription }],
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ imported: 1, skipped: 0, errors: [] });
    const stored = getDb()
      .prepare('SELECT jd_description FROM applications WHERE position_title = ?')
      .get('后端工程师') as { jd_description: string };
    expect(stored.jd_description).toBe(jdDescription);

    const tooLong = await fetch(`${baseUrl}/import/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ companyName: '超长 JD 公司', positionTitle: '测试岗位', jdDescription: 'x'.repeat(4001) }],
      }),
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('Excel 导出包含筛选条件下超过 100 条的全部记录', async () => {
    const matchingCount = 105;
    const result = importRecords([
      ...Array.from({ length: matchingCount }, (_, index) => ({
        companyName: '批量导出测试公司',
        positionTitle: `批量岗位-${String(index).padStart(3, '0')}`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        companyName: '其他公司',
        positionTitle: `其他岗位-${index}`,
      })),
    ]);
    expect(result).toMatchObject({ imported: matchingCount + 5, skipped: 0, errors: [] });

    const response = await fetch(`${baseUrl}/export/excel?keyword=${encodeURIComponent('批量导出测试公司')}`);
    expect(response.status).toBe(200);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(sheet).toBeDefined();
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, defval: '' }) as unknown[][];

    expect(rows).toHaveLength(matchingCount + 1);
    expect(rows.slice(1).map((row) => row[1])).toContain('批量岗位-104');
    expect(rows.slice(1).every((row) => row[0] === '批量导出测试公司')).toBe(true);
  });
});
