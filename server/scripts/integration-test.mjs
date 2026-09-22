import assert from 'node:assert/strict';
import * as XLSX from '../node_modules/xlsx/xlsx.mjs';

// 始终使用进程内临时数据库，避免验收测试污染用户的本地数据。
process.env.FINDJOB_DB_PATH = ':memory:';
process.env.HOST = '127.0.0.1';

const { createApp } = await import('../dist/index.js');
const server = createApp().listen(0, '127.0.0.1');

await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

const address = server.address();
assert(address && typeof address !== 'string', '测试服务器未能获取随机端口');
const BASE = `http://127.0.0.1:${address.port}/api`;

async function expectJson(response, expectedStatus) {
  const body = await response.json().catch(() => null);
  assert.equal(
    response.status,
    expectedStatus,
    `${response.url} 预期 HTTP ${expectedStatus}，实际 ${response.status}: ${JSON.stringify(body)}`,
  );
  assert(body && typeof body === 'object', `${response.url} 未返回 JSON 对象`);
  return body;
}

function makeExcelForm(filename) {
  const rows = [
    ['公司名称', '岗位名称', '岗位类型', '投递渠道', 'JD链接', '投递日期', '截止日期', '当前状态', '优先级', '备注'],
    ['测试公司A', '后端工程师', '校招', '官网', 'https://example.com/jd/1', '2025-09-01', '2025-12-31', '已投递', '高', '集成测试'],
    ['测试公司B', '前端实习生', '实习', '内推', '', '2025-09-02', '', '待投递', '中', ''],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '投递记录');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  return form;
}

try {
  const health = await expectJson(await fetch(`${BASE}/health`), 200);
  assert.equal(health.ok, true);

  const firstImport = await expectJson(
    await fetch(`${BASE}/import/excel`, { method: 'POST', body: makeExcelForm('test.xlsx') }),
    201,
  );
  assert.deepEqual(
    { imported: firstImport.imported, skipped: firstImport.skipped, errors: firstImport.errors },
    { imported: 2, skipped: 0, errors: [] },
  );

  const secondImport = await expectJson(
    await fetch(`${BASE}/import/excel`, { method: 'POST', body: makeExcelForm('test-again.xlsx') }),
    201,
  );
  assert.deepEqual(
    { imported: secondImport.imported, skipped: secondImport.skipped, errors: secondImport.errors },
    { imported: 0, skipped: 2, errors: [] },
  );

  const applications = await expectJson(await fetch(`${BASE}/applications?keyword=${encodeURIComponent('测试公司')}`), 200);
  assert.equal(applications.total, 2);
  assert.equal(applications.items.length, 2);
  const wishlist = applications.items.find((item) => item.status === 'WISHLIST');
  assert(wishlist, '未找到待投递记录');

  const transition = await expectJson(
    await fetch(`${BASE}/applications/${wishlist.id}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus: 'APPLIED', note: '集成测试状态流转' }),
    }),
    201,
  );
  assert.equal(transition.application.status, 'APPLIED');
  assert.equal(transition.event.fromStatus, 'WISHLIST');
  assert.equal(transition.event.toStatus, 'APPLIED');

  const overview = await expectJson(await fetch(`${BASE}/stats/overview`), 200);
  assert.equal(overview.total, 2);
  assert.equal(overview.byStatus.APPLIED, 2);

  const invalidId = await expectJson(await fetch(`${BASE}/applications/not-an-id`), 400);
  assert.equal(invalidId.error.code, 'VALIDATION_ERROR');

  const exportResponse = await fetch(`${BASE}/export/excel?keyword=${encodeURIComponent('测试公司')}`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') ?? '', /spreadsheet|octet-stream/i);
  assert((await exportResponse.arrayBuffer()).byteLength > 1_000, 'Excel 导出内容为空');

  const templateResponse = await fetch(`${BASE}/export/template`);
  assert.equal(templateResponse.status, 200);
  assert((await templateResponse.arrayBuffer()).byteLength > 1_000, 'Excel 模板内容为空');

  const emailError = await expectJson(
    await fetch(`${BASE}/email/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 7 }),
    }),
    400,
  );
  assert.equal(emailError.error.code, 'VALIDATION_ERROR');

  const resume = await expectJson(
    await fetch(`${BASE}/resumes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '推荐测试简历',
        targetRole: '后端开发工程师',
        basic: { name: '测试用户', city: 'London' },
        education: [],
        experience: [],
        projects: [],
        skills: ['TypeScript', 'Node.js', 'SQL'],
      }),
    }),
    201,
  );

  const profile = await expectJson(
    await fetch(`${BASE}/recommendations/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: resume.id,
        name: '后端岗位画像',
        minScore: 0,
        maxPages: 1,
        frequency: 'manual',
      }),
    }),
    201,
  );
  assert(profile.keywords.includes('后端开发工程师'), '未从简历求职意向派生关键词');
  assert.deepEqual(profile.cities, ['London']);

  const linkedinPlan = await expectJson(
    await fetch(`${BASE}/recommendations/profiles/${profile.id}/linkedin-plan`),
    200,
  );
  assert(linkedinPlan.queries.some((item) => item.queryText.includes('后端开发工程师')));
  assert.equal('url' in linkedinPlan.queries[0], false, 'LinkedIn 辅助不应生成自动访问链接');

  const recommendation = await expectJson(
    await fetch(`${BASE}/recommendations/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: profile.id,
        sourceId: 'linkedin-manual',
        companyName: '推荐测试公司',
        positionTitle: 'Backend Engineer',
        city: 'London',
        jdUrl: 'https://www.linkedin.com/jobs/view/1234567890',
        jdDescription: 'Build TypeScript and Node.js services backed by SQL.',
      }),
    }),
    201,
  );
  assert.equal(recommendation.sourceId, 'linkedin-manual');
  assert(Number.isInteger(recommendation.score));

  const recommendations = await expectJson(
    await fetch(`${BASE}/recommendations?profileId=${profile.id}`),
    200,
  );
  assert.equal(recommendations.total, 1);

  const importedRecommendation = await expectJson(
    await fetch(`${BASE}/recommendations/${recommendation.id}/import`, { method: 'POST' }),
    201,
  );
  assert.equal(importedRecommendation.recommendation.status, 'imported');
  const recommendedApplication = await expectJson(
    await fetch(`${BASE}/applications/${importedRecommendation.applicationId}`),
    200,
  );
  assert.equal(recommendedApplication.resumeId, resume.id);
  assert.equal(recommendedApplication.jdDescription, 'Build TypeScript and Node.js services backed by SQL.');

  console.log('✓ API 集成测试通过：核心 CRUD、Excel 往返、状态机、统计、错误边界、简历画像、LinkedIn 手动推荐与申请导入');
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
