import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { RawJobRecord } from '../domain/types.js';

/** Excel 模板列（文档 06 §3.2），与导出列完全一致保证往返无损 */
export const EXCEL_COLUMNS = [
  '公司名称',
  '岗位名称',
  '岗位类型',
  '投递渠道',
  'JD链接',
  '投递日期',
  '截止日期',
  '当前状态',
  '优先级',
  '备注',
] as const;

const COLUMN_INDEX: Record<string, number> = {};
EXCEL_COLUMNS.forEach((c, i) => (COLUMN_INDEX[c] = i));

/** Excel 日期序列值 → YYYY-MM-DD */
function excelDateToIso(v: unknown): string | undefined {
  if (typeof v === 'number') {
    const utc = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!Number.isNaN(utc.getTime())) {
      return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
    }
    return undefined;
  }
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 10);
  return undefined;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** 解析 .xlsx buffer：按模板列映射为 RawJobRecord[] */
export function parseExcelBuffer(buffer: Buffer): RawJobRecord[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Excel 文件为空');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  if (rows.length < 2) throw new Error('Excel 没有数据行');

  const records: RawJobRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => cellText(c) === '')) continue;
    const get = (col: string): string => cellText(r[COLUMN_INDEX[col]]);
    const record: RawJobRecord = {
      companyName: get('公司名称'),
      positionTitle: get('岗位名称'),
      jobType: get('岗位类型') as RawJobRecord['jobType'],
      channel: get('投递渠道'),
      jdUrl: get('JD链接'),
      appliedAt: excelDateToIso(r[COLUMN_INDEX['投递日期']]),
      deadline: excelDateToIso(r[COLUMN_INDEX['截止日期']]),
      status: get('当前状态'),
      priority: get('优先级') as RawJobRecord['priority'],
      note: get('备注'),
    };
    records.push(record);
  }
  return records;
}

/** 解析上传的 .xlsx 文件（磁盘路径） */
export function parseExcelFile(filePath: string): RawJobRecord[] {
  return parseExcelBuffer(readFileSync(filePath));
}

/** 生成导出 workbook（application 列表 → 模板列） */
export function buildExportWorkbook(rows: Array<Record<string, unknown>>): XLSX.WorkBook {
  const data = rows.map((a) => [
    a.companyName,
    a.positionTitle,
    a.jobType === 'intern' ? '实习' : '校招',
    a.channel ?? '',
    a.jdUrl ?? '',
    a.appliedAt ?? '',
    a.deadline ?? '',
    a.statusLabel,
    { HIGH: '高', MEDIUM: '中', LOW: '低' }[String(a.priority)] ?? '中',
    a.note ?? '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([[...EXCEL_COLUMNS], ...data]);
  ws['!cols'] = EXCEL_COLUMNS.map((_, i) => ({ wch: i === 4 ? 40 : i === 9 ? 30 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '投递记录');
  return wb;
}

/** 导出为 xlsx buffer */
export function exportToBuffer(rows: Array<Record<string, unknown>>): Buffer {
  const wb = buildExportWorkbook(rows);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 导入模板 workbook（含一行示例） */
export function buildTemplateWorkbook(): XLSX.WorkBook {
  const example = ['字节跳动', '后端开发工程师', '校招', '官网', 'https://jobs.bytedance.com/xxx', '2025-09-01', '2025-10-31', '已投递', '高', '示例行，导入前可删除'];
  const ws = XLSX.utils.aoa_to_sheet([[...EXCEL_COLUMNS], example]);
  ws['!cols'] = EXCEL_COLUMNS.map((_, i) => ({ wch: i === 4 ? 40 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '投递记录模板');
  return wb;
}
