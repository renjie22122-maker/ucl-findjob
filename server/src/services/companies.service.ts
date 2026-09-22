import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error.js';
import type { Company } from '../domain/types.js';
import { nowIso } from '../utils/time.js';

interface CompanyRow {
  id: number;
  name: string;
  industry: string | null;
  city: string | null;
  website: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    city: row.city,
    website: row.website,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CompanyInput {
  name: string;
  industry?: string | null;
  city?: string | null;
  website?: string | null;
  note?: string | null;
}

export function listCompanies(keyword?: string): (Company & { applicationCount: number })[] {
  const db = getDb();
  const rows = keyword
    ? (db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM applications a WHERE a.company_id = c.id) AS application_count
           FROM companies c WHERE c.name LIKE ? OR c.industry LIKE ? OR c.city LIKE ?
           ORDER BY c.updated_at DESC`,
        )
        .all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) as (CompanyRow & { application_count: number })[])
    : (db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM applications a WHERE a.company_id = c.id) AS application_count
           FROM companies c ORDER BY c.updated_at DESC`,
        )
        .all() as (CompanyRow & { application_count: number })[]);
  return rows.map((r) => ({ ...toCompany(r), applicationCount: r.application_count }));
}

export function getCompany(id: number): Company {
  const row = getDb().prepare('SELECT * FROM companies WHERE id = ?').get(id) as CompanyRow | undefined;
  if (!row) throw AppError.notFound('公司');
  return toCompany(row);
}

export function createCompany(input: CompanyInput): Company {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM companies WHERE name = ?').get(input.name);
  if (existing) throw AppError.conflict(`公司「${input.name}」已存在`);
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO companies (name, industry, city, website, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.name, input.industry ?? null, input.city ?? null, input.website ?? null, input.note ?? null, now, now);
  return getCompany(Number(info.lastInsertRowid));
}

export function updateCompany(id: number, input: CompanyInput): Company {
  const db = getDb();
  const row = db.prepare('SELECT id FROM companies WHERE id = ?').get(id);
  if (!row) throw AppError.notFound('公司');
  const dup = db.prepare('SELECT id FROM companies WHERE name = ? AND id != ?').get(input.name, id);
  if (dup) throw AppError.conflict(`公司「${input.name}」已存在`);
  db.prepare(
    `UPDATE companies SET name = ?, industry = ?, city = ?, website = ?, note = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name,
    input.industry ?? null,
    input.city ?? null,
    input.website ?? null,
    input.note ?? null,
    nowIso(),
    id,
  );
  return getCompany(id);
}

export function deleteCompany(id: number): void {
  const db = getDb();
  const row = db.prepare('SELECT id FROM companies WHERE id = ?').get(id);
  if (!row) throw AppError.notFound('公司');
  db.prepare('DELETE FROM companies WHERE id = ?').run(id);
}

/** 按名称查找（导入/邮件应用时用），不存在返回 undefined */
export function findCompanyByName(name: string): Company | undefined {
  const row = getDb().prepare('SELECT * FROM companies WHERE name = ?').get(name) as CompanyRow | undefined;
  return row ? toCompany(row) : undefined;
}

/** 模糊匹配公司名（邮件分析用） */
export function fuzzyFindCompany(name: string): Company | undefined {
  const row = getDb()
    .prepare('SELECT * FROM companies WHERE name = ? OR name LIKE ? OR ? LIKE name')
    .get(name, `%${name}%`, `%${name}%`) as CompanyRow | undefined;
  return row ? toCompany(row) : undefined;
}
