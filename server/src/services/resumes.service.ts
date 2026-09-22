import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error.js';
import { auditTimer } from './audit.service.js';
import { nowIso } from '../utils/time.js';

export interface ResumeBasic {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  github?: string;
  blog?: string;
  summary?: string;
}

export interface ResumeEducation {
  school: string;
  degree?: string;
  major?: string;
  start?: string;
  end?: string;
  gpa?: string;
  note?: string;
}

export interface ResumeExperience {
  company: string;
  role?: string;
  start?: string;
  end?: string;
  description: string[];
}

export interface ResumeProject {
  name: string;
  role?: string;
  link?: string;
  tech?: string[];
  description: string[];
}

export interface Resume {
  id: number;
  name: string;
  targetRole: string | null;
  basic: ResumeBasic | null;
  education: ResumeEducation[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  skills: string[];
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ResumeRow {
  id: number;
  name: string;
  target_role: string | null;
  basic: string | null;
  education: string | null;
  experience: string | null;
  projects: string | null;
  skills: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toResume(row: ResumeRow): Resume {
  return {
    id: row.id,
    name: row.name,
    targetRole: row.target_role,
    basic: parseJsonArray<ResumeBasic | null>(row.basic, null),
    education: parseJsonArray<ResumeEducation[]>(row.education, []),
    experience: parseJsonArray<ResumeExperience[]>(row.experience, []),
    projects: parseJsonArray<ResumeProject[]>(row.projects, []),
    skills: parseJsonArray<string[]>(row.skills, []),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ResumeInput {
  name: string;
  targetRole?: string | null;
  basic?: ResumeBasic | null;
  education?: ResumeEducation[];
  experience?: ResumeExperience[];
  projects?: ResumeProject[];
  skills?: string[];
  content?: string | null;
}

export function listResumes(): Resume[] {
  const rows = getDb().prepare('SELECT * FROM resumes ORDER BY updated_at DESC').all() as ResumeRow[];
  return rows.map(toResume);
}

export function getResume(id: number): Resume {
  const row = getDb().prepare('SELECT * FROM resumes WHERE id = ?').get(id) as ResumeRow | undefined;
  if (!row) throw AppError.notFound('简历');
  return toResume(row);
}

export function createResume(input: ResumeInput): Resume {
  const db = getDb();
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO resumes (name, target_role, basic, education, experience, projects, skills, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.targetRole ?? null,
      input.basic ? JSON.stringify(input.basic) : null,
      JSON.stringify(input.education ?? []),
      JSON.stringify(input.experience ?? []),
      JSON.stringify(input.projects ?? []),
      JSON.stringify(input.skills ?? []),
      input.content ?? null,
      now,
      now,
    );
  return getResume(Number(info.lastInsertRowid));
}

export function updateResume(id: number, input: Partial<ResumeInput>): Resume {
  const db = getDb();
  const current = getResume(id);
  const basic = input.basic === undefined ? current.basic : input.basic;
  db.prepare(
    `UPDATE resumes SET
       name = ?, target_role = ?, basic = ?, education = ?, experience = ?,
       projects = ?, skills = ?, content = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    (input.name ?? current.name).trim(),
    input.targetRole === undefined ? current.targetRole : input.targetRole,
    basic ? JSON.stringify(basic) : null,
    JSON.stringify(input.education ?? current.education),
    JSON.stringify(input.experience ?? current.experience),
    JSON.stringify(input.projects ?? current.projects),
    JSON.stringify(input.skills ?? current.skills),
    input.content === undefined ? current.content : input.content,
    nowIso(),
    id,
  );
  return getResume(id);
}

export function deleteResume(id: number): void {
  const db = getDb();
  const row = db.prepare('SELECT id FROM resumes WHERE id = ?').get(id);
  if (!row) throw AppError.notFound('简历');
  db.prepare('DELETE FROM resumes WHERE id = ?').run(id);
}

// ---------- GitHub 主页导入（公开 API，无需认证） ----------

export interface GithubImportResult {
  profile: {
    login: string;
    name: string | null;
    bio: string | null;
    company: string | null;
    location: string | null;
    blog: string | null;
    avatarUrl: string | null;
  };
  repos: Array<{
    name: string;
    description: string | null;
    language: string | null;
    htmlUrl: string;
    stars: number;
    fork: boolean;
  }>;
}

export async function fetchGithubProfile(username: string): Promise<GithubImportResult> {
  const timer = auditTimer({
    kind: 'github',
    target: `https://api.github.com/users/${username}`,
    detail: `拉取 GitHub 主页与仓库列表（用户名 ${username}）`,
  });
  try {
    const [profileRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'findjob', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000),
      }),
      fetch(
        `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=30`,
        {
          headers: { 'User-Agent': 'findjob', Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15000),
        },
      ),
    ]);
    if (profileRes.status === 404) {
      timer.fail('用户不存在');
      throw AppError.notFound(`GitHub 用户 ${username} 不存在`);
    }
    if (!profileRes.ok || !reposRes.ok) {
      timer.fail(`HTTP ${profileRes.status}/${reposRes.status}`);
      throw AppError.badGateway('GitHub API 请求失败，请稍后重试');
    }
    const profile = (await profileRes.json()) as Record<string, unknown>;
    const repos = (await reposRes.json()) as Array<Record<string, unknown>>;
    const result: GithubImportResult = {
      profile: {
        login: String(profile.login ?? username),
        name: (profile.name as string) ?? null,
        bio: (profile.bio as string) ?? null,
        company: (profile.company as string) ?? null,
        location: (profile.location as string) ?? null,
        blog: (profile.blog as string) ?? null,
        avatarUrl: (profile.avatar_url as string) ?? null,
      },
      repos: repos
        .filter((r) => !r.fork)
        .map((r) => ({
          name: String(r.name),
          description: (r.description as string) ?? null,
          language: (r.language as string) ?? null,
          htmlUrl: String(r.html_url),
          stars: Number(r.stargazers_count ?? 0),
          fork: Boolean(r.fork),
        })),
    };
    timer.ok(`主页 + ${result.repos.length} 个仓库`);
    return result;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    timer.fail(message);
    throw AppError.badGateway(`GitHub 导入失败：${message}`);
  }
}

// ---------- HTML 简历导出 ----------

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeExternalHref(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/** 生成中文简历 HTML（内联样式，浏览器可打印为 PDF） */
export function buildResumeHtml(resume: Resume): string {
  const b = resume.basic ?? {};
  const edu = resume.education
    .map(
      (e) => `<li><strong>${esc(e.school)}</strong>${e.degree ? ` · ${esc(e.degree)}` : ''}${e.major ? ` · ${esc(e.major)}` : ''}
      ${e.start || e.end ? `<span class="date">${esc(e.start ?? '')} - ${esc(e.end ?? '')}</span>` : ''}
      ${e.gpa ? `<div class="sub">GPA：${esc(e.gpa)}</div>` : ''}${e.note ? `<div class="sub">${esc(e.note)}</div>` : ''}</li>`,
    )
    .join('');
  const exp = resume.experience
    .map(
      (e) => `<li><strong>${esc(e.company)}</strong>${e.role ? ` · ${esc(e.role)}` : ''}
      ${e.start || e.end ? `<span class="date">${esc(e.start ?? '')} - ${esc(e.end ?? '')}</span>` : ''}
      <ul>${e.description.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></li>`,
    )
    .join('');
  const proj = resume.projects
    .map((p) => {
      const href = safeExternalHref(p.link);
      const link = p.link
        ? href
          ? ` · <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.link)}</a>`
          : ` · ${esc(p.link)}`
        : '';
      return `<li><strong>${esc(p.name)}</strong>${p.role ? ` · ${esc(p.role)}` : ''}
      ${link}
      ${p.tech?.length ? `<div class="sub">技术栈：${esc(p.tech.join(' / '))}</div>` : ''}
      <ul>${p.description.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></li>`;
    })
    .join('');

  const contact = [
    b.email ? `📧 ${esc(b.email)}` : null,
    b.phone ? `📱 ${esc(b.phone)}` : null,
    b.city ? `📍 ${esc(b.city)}` : null,
    b.github ? `GitHub：${esc(b.github)}` : null,
    b.blog ? `主页：${esc(b.blog)}` : null,
  ]
    .filter(Boolean)
    .join(' ｜ ');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(b.name ?? resume.name)} - 简历</title>
<style>
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #222; max-width: 800px; margin: 0 auto; padding: 32px; line-height: 1.7; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  .contact { color: #666; font-size: 13px; margin-bottom: 14px; }
  h2 { font-size: 16px; border-bottom: 2px solid #1677ff; padding-bottom: 4px; margin: 18px 0 8px; color: #1677ff; }
  ul { margin: 4px 0; padding-left: 20px; } li { margin-bottom: 4px; }
  .date { float: right; color: #999; font-size: 12px; }
  .sub { color: #666; font-size: 13px; }
  .summary { color: #444; font-size: 14px; }
  @media print { body { padding: 0; } h2 { -webkit-print-color-adjust: exact; } }
</style></head><body>
<h1>${esc(b.name ?? '未命名简历')}</h1>
${resume.targetRole ? `<div class="sub">求职意向：${esc(resume.targetRole)}</div>` : ''}
<div class="contact">${contact}</div>
${b.summary ? `<h2>个人简介</h2><div class="summary">${esc(b.summary)}</div>` : ''}
${edu ? `<h2>教育经历</h2><ul>${edu}</ul>` : ''}
${exp ? `<h2>实习/工作经历</h2><ul>${exp}</ul>` : ''}
${proj ? `<h2>项目经历</h2><ul>${proj}</ul>` : ''}
${resume.skills.length ? `<h2>专业技能</h2><div>${esc(resume.skills.join(' / '))}</div>` : ''}
</body></html>`;
}
