import type { RawJobRecord, SourceInfo } from '../domain/types.js';

export interface CrawlParams {
  keyword?: string;
  recruitType?: string;
  maxPages?: number;
}

/** 一个职位来源只负责描述自身参数并返回统一的 RawJobRecord。 */
export interface JobSourceAdapter {
  info: SourceInfo;
  fetch: (params: CrawlParams) => Promise<RawJobRecord[]>;
}
