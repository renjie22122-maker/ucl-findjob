import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.PORT ?? 3001);

/**
 * 默认仅监听本机，避免无鉴权的本地管理接口（含邮箱及 OAuth 配置）
 * 意外暴露到局域网。确需容器/局域网访问时可显式设置 HOST=0.0.0.0。
 */
export function resolveHost(value: string | undefined): string {
  return value?.trim() || '127.0.0.1';
}

export const HOST = resolveHost(process.env.HOST);

/** SQLite 数据文件路径（可用 FINDJOB_DB_PATH 覆盖，测试用 ':memory:'） */
export const DB_PATH = process.env.FINDJOB_DB_PATH ?? path.resolve(__dirname, '../data/findjob.db');

/** 爬虫限速（毫秒/请求） */
export const CRAWL_RATE_LIMIT_MS = Number(process.env.CRAWL_RATE_LIMIT_MS ?? 1500);
export const CRAWL_MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES ?? 10);

/** 邮件分析默认参数 */
export const EMAIL_ANALYZE_MAX_DAYS = 30;
export const EMAIL_SNIPPET_LENGTH = 300;
