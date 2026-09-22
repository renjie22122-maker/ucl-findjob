import { getDb } from '../db/connection.js';
import { STATUS_LABELS } from '../domain/status.js';
import type { AppStatus } from '../domain/status.js';
import type { ImportResult, RawJobRecord } from '../domain/types.js';
import { createApplication } from './applications.service.js';
import { createCompany, findCompanyByName } from './companies.service.js';
import { nowIso } from '../utils/time.js';

const LABEL_TO_STATUS = new Map<string, AppStatus>(
  Object.entries(STATUS_LABELS).map(([k, v]) => [v, k as AppStatus]),
);

const CHANNEL_LABELS = new Map<string, string>([
  ['官网', '官网'],
  ['牛客', '牛客网'],
  ['牛客网', '牛客网'],
  ['Boss', 'Boss直聘'],
  ['boss直聘', 'Boss直聘'],
  ['Boss直聘', 'Boss直聘'],
  ['内推', '内推'],
]);

const JOB_TYPE_LABELS = new Map<string, 'school' | 'intern'>([
  ['校招', 'school'],
  ['实习', 'intern'],
]);

const PRIORITY_LABELS = new Map<string, 'HIGH' | 'MEDIUM' | 'LOW'>([
  ['高', 'HIGH'],
  ['中', 'MEDIUM'],
  ['低', 'LOW'],
]);

function normalizeStatus(raw: string | undefined): AppStatus {
  if (!raw) return 'WISHLIST';
  const v = raw.trim();
  if (LABEL_TO_STATUS.has(v)) return LABEL_TO_STATUS.get(v)!;
  if (STATUS_LABELS[v as AppStatus]) return v as AppStatus;
  return 'WISHLIST';
}

function normalizeJobType(raw: string | undefined): 'school' | 'intern' {
  if (!raw) return 'school';
  const v = raw.trim();
  if (JOB_TYPE_LABELS.has(v)) return JOB_TYPE_LABELS.get(v)!;
  return v === 'intern' ? 'intern' : 'school';
}

function normalizeChannel(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const v = raw.trim();
  return CHANNEL_LABELS.get(v) ?? v;
}

function normalizePriority(raw: string | undefined): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (!raw) return 'MEDIUM';
  const v = raw.trim();
  return PRIORITY_LABELS.get(v) ?? 'MEDIUM';
}

function normalizeDate(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const v = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** 合成备注：薪资/城市等额外信息并入 note（文档 06 §4） */
function buildNote(record: RawJobRecord): string | undefined {
  const parts: string[] = [];
  if (record.salary) parts.push(`薪资：${record.salary}`);
  if (record.city) parts.push(`城市：${record.city}`);
  const merged = [parts.join('；'), record.note].filter(Boolean).join('；');
  return merged || undefined;
}

/**
 * ImportService：统一入库管线（文档 06 §3.3）
 * 校验 → 规范化 → 公司查重（不存在则建）→ 申请去重（公司+岗位）→ 入库
 */
export function importRecords(records: RawJobRecord[]): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
  const db = getDb();
  const batchSeen = new Set<string>();

  const importOne = db.transaction(() => {
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const row = i + 1;
      try {
        const companyName = record.companyName?.trim();
        const positionTitle = record.positionTitle?.trim();
        if (!companyName) throw new Error('缺少公司名称');
        if (!positionTitle) throw new Error('缺少岗位名称');

        // 1. 公司查重/创建
        let company = findCompanyByName(companyName);
        if (!company) {
          company = createCompany({
            name: companyName,
            industry: record.companyIndustry || undefined,
            city: record.companyCity || record.city || undefined,
            website: record.companyWebsite || undefined,
          });
        }

        // 2. 申请去重：库内 + 批次内
        const dupKey = `${company.id}:${positionTitle}`;
        if (batchSeen.has(dupKey)) {
          result.skipped++;
          continue;
        }
        const existing = db
          .prepare('SELECT id FROM applications WHERE company_id = ? AND position_title = ?')
          .get(company.id, positionTitle);
        if (existing) {
          result.skipped++;
          batchSeen.add(dupKey);
          continue;
        }
        batchSeen.add(dupKey);

        // 3. 入库
        const note = buildNote(record);
        const appliedAt = normalizeDate(record.appliedAt);
        createApplication({
          companyId: company.id,
          positionTitle,
          jobType: normalizeJobType(record.jobType),
          channel: normalizeChannel(record.channel),
          jdUrl: record.jdUrl?.trim() || undefined,
          status: normalizeStatus(record.status),
          priority: normalizePriority(record.priority),
          deadline: normalizeDate(record.deadline),
          appliedAt,
          note,
          jdDescription: record.jdDescription?.slice(0, 4000) || undefined,
        });
        result.imported++;
      } catch (err) {
        const message = err instanceof Error ? err.message : '导入失败';
        // 冲突（公司已存在）在上面的查重逻辑中一般不会触发，防御兜底
        if (message.includes('已存在')) {
          result.skipped++;
        } else {
          result.errors.push({ row, message });
        }
      }
    }
  });

  importOne();
  return result;
}

/** 单个手动录入记录入库（ManualAdapter 走同一管线） */
export function importSingle(record: RawJobRecord): ImportResult {
  return importRecords([record]);
}

// 导出供测试
export { normalizeStatus, normalizeDate, buildNote };
