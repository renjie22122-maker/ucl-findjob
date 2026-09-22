import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { closeDb, getDb } from '../db/connection.js';
import { createCompany } from '../services/companies.service.js';

describe('申请 API', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
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

  it('创建、读取和清空 JD 描述', async () => {
    const company = createCompany({ name: 'JD API 测试公司' });
    const jdDescription = '负责推荐系统，要求 TypeScript、SQL 与数据建模经验。';
    const created = await fetch(`${baseUrl}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: company.id, positionTitle: '平台工程师', jdDescription }),
    });

    expect(created.status).toBe(201);
    const application = (await created.json()) as { id: number; jdDescription: string | null };
    expect(application.jdDescription).toBe(jdDescription);

    const fetched = await fetch(`${baseUrl}/applications/${application.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({ jdDescription });

    const cleared = await fetch(`${baseUrl}/applications/${application.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jdDescription: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ jdDescription: null });
  });

  it('拒绝超过 4000 字的 JD 描述', async () => {
    const company = createCompany({ name: '超长 JD API 测试公司' });
    const response = await fetch(`${baseUrl}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: company.id, positionTitle: '测试岗位', jdDescription: 'x'.repeat(4001) }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
