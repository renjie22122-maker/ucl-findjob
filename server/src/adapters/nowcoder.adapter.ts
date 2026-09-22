import { CRAWL_MAX_PAGES, CRAWL_RATE_LIMIT_MS } from '../config.js';
import type { RawJobRecord } from '../domain/types.js';
import { auditTimer } from '../services/audit.service.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SEARCH_URL = 'https://nowpick.nowcoder.com/u/job/search';
const REFERER = 'https://www.nowcoder.com/jobs/fulltime/center?recruitType=2';

export interface NowcoderParams {
  keyword: string;
  recruitType: 'school' | 'intern';
  maxPages: number;
}

/** API recruitType 语义：1=校招 2=实习 3=社招 */
const API_RECRUIT_TYPE: Record<NowcoderParams['recruitType'], number> = {
  school: 1,
  intern: 2,
};

interface SearchJobItem {
  id: number;
  jobName: string;
  jobCity?: string;
  recruitType?: number;
  salaryType?: number;
  salaryMin?: number;
  salaryMax?: number;
  salaryMonth?: number;
  salaryShow?: string | null;
  deliverEnd?: number;
  ext?: string;
  recommendInternCompany?: { companyName?: string } | null;
  user?: { identity?: Array<{ companyName?: string }> } | null;
}

export interface SearchResponse {
  code: number;
  msg?: string;
  data?: {
    totalCount?: number;
    totalPage?: number;
    currentPage?: number;
    datas?: SearchJobItem[];
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toK(v: number): number {
  return v >= 1000 ? Math.round(v / 1000) : v;
}

function formatSalary(d: SearchJobItem): string | undefined {
  if (d.salaryShow) return d.salaryShow;
  const min = d.salaryMin ?? 0;
  const max = d.salaryMax ?? 0;
  if (!min && !max) return undefined;
  if (d.salaryType === 1) return `${min}-${max}/天`;
  const minK = toK(min);
  const maxK = toK(max);
  const range = minK === maxK ? `${minK}K` : `${minK}-${maxK}K`;
  return d.salaryMonth && d.salaryMonth > 12 ? `${range}·${d.salaryMonth}薪` : range;
}

/** 投递截止时间：deliverEnd 为毫秒时间戳，仅保留未来 3 年内的有效截止日期 */
function formatDeadline(ms: number | undefined): string | undefined {
  if (!ms) return undefined;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = Date.now();
  if (d.getTime() < now || d.getTime() > now + 3 * 365 * 86400_000) return undefined;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 解析 ext 字段中的 JD 全文（infos 优先，requirements 兜底；供岗位匹配使用） */
function formatJdDescription(extRaw: string | undefined): string | undefined {
  if (!extRaw) return undefined;
  try {
    const ext = JSON.parse(extRaw) as { infos?: string; requirements?: string };
    const text = (ext.infos ?? ext.requirements ?? '').trim();
    return text ? text.slice(0, 2000) : undefined;
  } catch {
    return undefined;
  }
}

/** 解析搜索接口响应（纯函数，便于单测） */
export function parseSearchResponse(json: SearchResponse): RawJobRecord[] {
  if (json.code !== 0 || !json.data?.datas) return [];
  const records: RawJobRecord[] = [];
  for (const item of json.data.datas) {
    const companyName =
      item.recommendInternCompany?.companyName?.trim() ||
      item.user?.identity?.[0]?.companyName?.trim() ||
      '未知公司';
    const title = item.jobName?.trim();
    if (!title) continue;
    records.push({
      sourceKey: `nowcoder:${item.id}`,
      companyName,
      positionTitle: title,
      jobType: item.recruitType === 2 ? 'intern' : 'school',
      channel: '牛客网',
      jdUrl: `https://www.nowcoder.com/job/detail/${item.id}`,
      salary: formatSalary(item),
      city: item.jobCity || undefined,
      deadline: formatDeadline(item.deliverEnd),
      jdDescription: formatJdDescription(item.ext),
    });
  }
  return records;
}

function dedupe(records: RawJobRecord[]): RawJobRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = r.sourceKey ?? `${r.companyName}|${r.positionTitle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildBody(params: NowcoderParams, page: number): URLSearchParams {
  return new URLSearchParams({
    keyword: params.keyword,
    city: '',
    careerJobId: '',
    recruitType: String(API_RECRUIT_TYPE[params.recruitType]),
    pageSize: '20',
    recommend: '0',
    requestFrom: '0',
    pageSource: '5026',
    page: String(page),
  });
}

/** 限速分页抓取牛客网职位搜索接口（文档 06 §4），全程记录出站审计 */
export async function fetchNowcoderJobs(params: NowcoderParams): Promise<RawJobRecord[]> {
  const pages = Math.min(CRAWL_MAX_PAGES, Math.max(1, params.maxPages));
  const all: RawJobRecord[] = [];
  const timer = auditTimer({
    kind: 'crawl',
    target: SEARCH_URL,
    detail: `关键词=${params.keyword}；类型=${params.recruitType === 'intern' ? '实习' : '校招'}；页数=${pages}`,
  });

  for (let page = 1; page <= pages; page++) {
    await sleep(page === 1 ? 0 : CRAWL_RATE_LIMIT_MS);
    let json: SearchResponse;
    try {
      const res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Origin: 'https://www.nowcoder.com',
          Referer: REFERER,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: buildBody(params, page),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = (await res.json()) as SearchResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (page === 1) {
        timer.fail(msg);
        throw new Error(`抓取失败：${msg}`);
      }
      break; // 后续页失败不再继续，保留已抓取结果
    }

    const records = parseSearchResponse(json);
    if (records.length === 0) {
      if (page === 1) {
        timer.fail('接口未返回职位数据（结构可能已变化）');
        throw new Error('接口未返回职位数据（结构可能已变化）');
      }
      break; // 已到末页
    }
    all.push(...records);
  }

  const deduped = dedupe(all);
  timer.ok(`抓取到 ${deduped.length} 条职位`);
  return deduped;
}
