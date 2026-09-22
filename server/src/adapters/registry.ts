import { AppError } from '../middleware/error.js';
import type { CrawlResult, RawJobRecord, SourceInfo } from '../domain/types.js';
import { fetchNowcoderJobs } from './nowcoder.adapter.js';
import type { CrawlParams, JobSourceAdapter } from './types.js';

export type { CrawlParams, JobSourceAdapter } from './types.js';

/**
 * 数据源注册表（文档 06 §5）：新增数据源在此登记 + 实现 fetch 分支，
 * UI 数据源页自动枚举展示。
 */
const ADAPTERS: JobSourceAdapter[] = [
  {
    info: {
      id: 'nowcoder',
      name: '牛客网',
      description: '按关键词抓取校招/实习职位列表（公司、岗位、薪资、城市、JD 链接）',
      params: [
        { key: 'keyword', label: '关键词', type: 'text', required: true },
        {
          key: 'recruitType',
          label: '类型',
          type: 'select',
          default: 'school',
          options: [
            { value: 'school', label: '校招' },
            { value: 'intern', label: '实习' },
          ],
        },
        { key: 'maxPages', label: '页数', type: 'number', default: 3, max: 10 },
      ],
    },
    fetch: async (params) => {
      if (!params.keyword?.trim()) throw AppError.validation('关键词不能为空');
      return fetchNowcoderJobs({
        keyword: params.keyword,
        recruitType: params.recruitType === 'intern' ? 'intern' : 'school',
        maxPages: params.maxPages ?? 3,
      });
    },
  },
];

export const SOURCES: SourceInfo[] = ADAPTERS.map((adapter) => adapter.info);

export function listSources(): SourceInfo[] {
  return SOURCES;
}

export function getSource(id: string): SourceInfo {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw AppError.validation(`未知数据源：${id}`);
  return source;
}

export function getSourceAdapter(id: string): JobSourceAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.info.id === id);
  if (!adapter) throw AppError.validation(`未知数据源：${id}`);
  return adapter;
}

export async function crawl(sourceId: string, params: CrawlParams): Promise<CrawlResult> {
  const adapter = getSourceAdapter(sourceId);
  const records: RawJobRecord[] = await adapter.fetch(params);
  return { sourceId, count: records.length, records };
}

/** 聚合抓取多个数据源并合并去重（公司+岗位优先保留先抓取的数据源；单源失败不影响整体） */
export async function crawlMany(sourceIds: string[], params: CrawlParams): Promise<CrawlResult> {
  const all: RawJobRecord[] = [];
  const seen = new Set<string>();
  const results = await Promise.all(
    sourceIds.map(async (id) => {
      try {
        return await crawl(id, params);
      } catch (err) {
        console.warn(`[crawl-many] 数据源 ${id} 失败：`, err instanceof Error ? err.message : err);
        return null;
      }
    }),
  );
  for (const result of results) {
    if (!result) continue;
    for (const record of result.records) {
      const key = `${record.companyName}|${record.positionTitle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(record);
    }
  }
  return { sourceId: sourceIds.join('+'), count: all.length, records: all };
}
