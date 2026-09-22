import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/connection.js';
import { createApp } from '../index.js';
import { createResume } from '../services/resumes.service.js';

async function jsonRequest(baseUrl: string, path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

describe('岗位推荐 API', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/recommendations`;
  });

  beforeEach(() => {
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
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    closeDb();
  });

  it('画像 CRUD 使用 camelCase 契约、空关键词自动派生并严格拒绝未知字段', async () => {
    const resume = createResume({
      name: 'API 简历',
      targetRole: 'Backend Engineer',
      basic: { city: 'London' },
      skills: ['TypeScript'],
    });
    const created = await jsonRequest(baseUrl, '/profiles', {
      method: 'POST',
      body: JSON.stringify({ resumeId: resume.id, name: '英国后端', keywords: [] }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      resumeId: resume.id,
      name: '英国后端',
      cities: ['London'],
      sourceIds: ['nowcoder'],
      frequency: 'manual',
    });
    expect((created.body as { keywords: string[] }).keywords).toContain('Backend Engineer TypeScript');
    const id = (created.body as { id: number }).id;

    const list = await jsonRequest(baseUrl, '/profiles');
    expect(list.body).toMatchObject({ items: [{ id, resumeId: resume.id }] });
    const detail = await jsonRequest(baseUrl, `/profiles/${id}`);
    expect(detail.body).toMatchObject({ id, name: '英国后端' });

    const updated = await jsonRequest(baseUrl, `/profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ minScore: 75, frequency: 'weekly', enabled: false }),
    });
    expect(updated.body).toMatchObject({ minScore: 75, frequency: 'weekly', enabled: 0 });

    const unknown = await jsonRequest(baseUrl, '/profiles', {
      method: 'POST',
      body: JSON.stringify({ resumeId: resume.id, name: '非法', unexpected: true }),
    });
    expect(unknown.response.status).toBe(400);
    expect(unknown.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const plan = await jsonRequest(baseUrl, `/profiles/${id}/linkedin-plan`);
    expect(plan.body).toMatchObject({ profileId: id, queries: expect.any(Array), notice: expect.any(String) });
    expect((plan.body as { queries: Array<{ queryText: string }> }).queries[0].queryText).not.toMatch(/^https?:/);

    const removed = await jsonRequest(baseUrl, `/profiles/${id}`, { method: 'DELETE' });
    expect(removed.response.status).toBe(204);
  });

  it('人工岗位仅接受 HTTP(S)，支持筛选、状态更新和正式导入', async () => {
    const resume = createResume({
      name: '手动导入简历',
      targetRole: 'Java Backend Developer',
      basic: { city: 'London' },
      education: [{ school: 'UCL', degree: '本科' }],
      skills: ['Java'],
    });
    const profileResult = await jsonRequest(baseUrl, '/profiles', {
      method: 'POST',
      body: JSON.stringify({ resumeId: resume.id, name: 'LinkedIn 手动岗位', minScore: 60 }),
    });
    const profileId = (profileResult.body as { id: number }).id;

    const ftp = await jsonRequest(baseUrl, '/manual', {
      method: 'POST',
      body: JSON.stringify({
        profileId,
        companyName: 'Unsafe Co',
        positionTitle: 'Java Developer',
        jdUrl: 'ftp://example.com/job',
      }),
    });
    expect(ftp.response.status).toBe(400);

    const manual = await jsonRequest(baseUrl, '/manual', {
      method: 'POST',
      body: JSON.stringify({
        profileId,
        sourceId: 'linkedin-manual',
        companyName: 'Linked Co',
        positionTitle: 'Java Backend Developer',
        city: 'London',
        jdUrl: 'https://www.linkedin.com/jobs/view/42',
        jdDescription: '要求本科，熟悉 Java',
      }),
    });
    expect(manual.response.status).toBe(201);
    expect(manual.body).toMatchObject({ profileId, sourceId: 'linkedin-manual', status: 'new' });
    const recommendationId = (manual.body as { id: number }).id;

    const filtered = await jsonRequest(baseUrl, `/?profileId=${profileId}&status=new&minScore=60`);
    expect(filtered.body).toMatchObject({ total: 1, items: [{ id: recommendationId }] });
    const badQuery = await jsonRequest(baseUrl, '/?unknown=true');
    expect(badQuery.response.status).toBe(400);

    const saved = await jsonRequest(baseUrl, `/${recommendationId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'saved' }),
    });
    expect(saved.body).toMatchObject({ id: recommendationId, status: 'saved' });

    const imported = await jsonRequest(baseUrl, `/${recommendationId}/import`, { method: 'POST' });
    expect(imported.response.status).toBe(201);
    expect(imported.body).toMatchObject({ imported: true, applicationId: expect.any(Number) });
    expect(getDb().prepare('SELECT resume_id FROM applications').get()).toEqual({ resume_id: resume.id });

    const batch = await jsonRequest(baseUrl, '/import-batch', {
      method: 'POST',
      body: JSON.stringify({ ids: [recommendationId, 999999] }),
    });
    expect(batch.response.status).toBe(201);
    expect(batch.body).toMatchObject({ imported: 0, skipped: 1, errors: [{ id: 999999 }] });

    const runs = await jsonRequest(baseUrl, `/runs?profileId=${profileId}`);
    expect(runs.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });
});
