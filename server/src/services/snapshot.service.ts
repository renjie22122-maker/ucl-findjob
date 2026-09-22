import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error.js';
import { STATUS_LABELS } from '../domain/status.js';
import { nowIso } from '../utils/time.js';
import { auditTimer } from './audit.service.js';

/**
 * M10 云同步/公开视图：导出静态快照（JSON/HTML），可选自动 git 提交推送到 GitHub Pages。
 * 借鉴 autumn-recruitment-tracker 的轻量方案：不依赖服务器，静态文件即可公开只读。
 */

export interface SnapshotData {
  generatedAt: string;
  stats: Record<string, unknown>;
  companies: Array<Record<string, unknown>>;
  applications: Array<Record<string, unknown>>;
}

export function buildSnapshot(): SnapshotData {
  const db = getDb();
  // 公开快照只导出展示所需字段；备注、简历关联和 JD 全文等私密数据不得进入待发布 JSON。
  const companies = db
    .prepare('SELECT id, name, industry, city, website FROM companies ORDER BY name')
    .all() as Array<Record<string, unknown>>;
  const applications = db
    .prepare(
      `SELECT a.id, a.company_id, c.name AS company_name, a.position_title, a.job_type,
              a.channel, a.jd_url, a.status, a.priority, a.deadline, a.applied_at,
              a.created_at, a.updated_at
       FROM applications a
       JOIN companies c ON c.id = a.company_id
       ORDER BY a.updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  const reminders = db.prepare('SELECT COUNT(*) AS c FROM reminders WHERE done = 0').get() as { c: number };
  const total = applications.length;
  const active = applications.filter((a) => !['SIGNED', 'REJECTED', 'WITHDRAWN'].includes(String(a.status))).length;

  return {
    generatedAt: nowIso(),
    stats: { total, active, pendingReminders: reminders.c },
    companies,
    applications: applications.map((a) => ({ ...a, statusLabel: STATUS_LABELS[a.status as keyof typeof STATUS_LABELS] })),
  };
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 公开页面仅允许普通 HTTP(S) 链接，拒绝 javascript:/data:/file: 等可执行或本地协议。 */
function safeHref(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** 静态只读 HTML 快照（自包含，GitHub Pages 直接可用） */
export function buildSnapshotHtml(snapshot: SnapshotData): string {
  const rows = snapshot.applications
    .map((a) => {
      const jdHref = safeHref(a.jd_url);
      return `<tr>
<td>${esc(a.company_name)}</td><td>${esc(a.position_title)}</td>
<td><span class="st">${esc(a.statusLabel)}</span></td>
<td>${esc(a.priority === 'HIGH' ? '高' : a.priority === 'MEDIUM' ? '中' : '低')}</td>
<td>${esc(a.applied_at)}</td><td>${esc(a.deadline)}</td>
<td>${jdHref ? `<a href="${esc(jdHref)}" target="_blank" rel="noopener noreferrer">JD</a>` : '-'}</td>
</tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>我的秋招进度（FindJob 快照）</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; max-width: 960px; margin: 24px auto; padding: 0 16px; color: #222; }
  h1 { font-size: 20px; } .meta { color: #888; font-size: 13px; margin-bottom: 12px; }
  .stat { display: inline-block; margin-right: 18px; font-size: 14px; }
  .stat b { font-size: 22px; color: #1677ff; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; }
  th { background: #fafafa; }
  .st { background: #e6f4ff; color: #1677ff; padding: 1px 8px; border-radius: 8px; }
  a { color: #1677ff; }
</style></head><body>
<h1>🎯 我的秋招进度</h1>
<div class="meta">由 FindJob 生成于 ${esc(snapshot.generatedAt)} · 只读快照</div>
<div>
  <span class="stat">总投递 <b>${snapshot.stats.total}</b></span>
  <span class="stat">进行中 <b>${snapshot.stats.active}</b></span>
  <span class="stat">待办提醒 <b>${snapshot.stats.pendingReminders}</b></span>
</div>
<table>
<thead><tr><th>公司</th><th>岗位</th><th>状态</th><th>优先级</th><th>投递日期</th><th>截止日期</th><th>JD</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body></html>`;
}

/** 发布到本地 git 仓库并推送（GitHub Pages 方案）；stdio inherit 避免沙箱管道限制 */
export async function publishSnapshot(repoPath: string, message?: string): Promise<{ ok: boolean; output: string }> {
  if (!repoPath || !existsSync(repoPath)) throw AppError.validation('仓库路径不存在');
  if (!existsSync(`${repoPath}/.git`)) throw AppError.validation('该目录不是 git 仓库');

  const snapshot = buildSnapshot();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${repoPath}/snapshot.html`, buildSnapshotHtml(snapshot), 'utf8');
  writeFileSync(`${repoPath}/snapshot.json`, JSON.stringify(snapshot, null, 2), 'utf8');

  const timer = auditTimer({
    kind: 'publish',
    target: repoPath,
    detail: '导出快照并 git 提交推送到 GitHub Pages',
  });

  const runGit = (args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      // stdio inherit：兼容受限环境（管道捕获会被沙箱拦截），输出直接进服务日志
      const child = spawn('git', args, { cwd: repoPath, stdio: ['ignore', 'inherit', 'inherit'] });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} 失败（code ${code}）`))));
    });

  try {
    await runGit(['add', 'snapshot.html', 'snapshot.json']);
    await runGit(['commit', '-m', message ?? `FindJob 快照更新 ${nowIso()}`]);
    await runGit(['push', 'origin', 'main']);
    timer.ok('发布成功');
    return { ok: true, output: '快照已提交并推送到 origin/main（GitHub Pages 生效需等待其构建）' };
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    timer.fail(messageText);
    return { ok: false, output: messageText };
  }
}
