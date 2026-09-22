import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../middleware/error.js';

export const MAX_PUBLIC_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_PUBLIC_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 8_000;

interface ResolvedAddress {
  address: string;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const defaultResolver: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

function normalizeHostname(hostname: string): string {
  const withoutBrackets = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return withoutBrackets.replace(/\.$/, '').toLowerCase();
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPublicIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [a, b, c] = parts;

  // 非公网、链路本地、运营商 NAT、文档/基准测试及组播/保留地址。
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Groups(address: string): number[] | null {
  let normalized = address.toLowerCase();
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex);

  // 将 IPv4 尾部转换为两个 16 位分组，例如 ::ffff:127.0.0.1。
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const parts = ipv4Parts(normalized.slice(lastColon + 1));
    if (lastColon < 0 || !parts) return null;
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const rawGroups = halves.length === 2
    ? [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    : left;
  if (rawGroups.length !== 8) return null;
  const groups = rawGroups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : -1));
  return groups.some((group) => group < 0) ? null : groups;
}

function isPublicIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return false;

  // 拒绝 IPv4 映射/兼容写法，防止用另一种文本表示绕过 IPv4 检查。
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0 || groups[5] === 0xffff)) {
    return false;
  }

  // 当前公网单播 IPv6 位于 2000::/3；再排除文档及隧道专用前缀。
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  if (groups[0] === 0x2001 && (groups[1] === 0 || groups[1] === 0x0db8)) return false;
  if (groups[0] === 0x2002) return false;
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? isPublicIpv4(address) : version === 6 ? isPublicIpv6(address) : false;
}

/** 只接受不含凭据的公网 HTTP(S) URL；域名解析在 assertPublicHttpUrl 中完成。 */
export function parsePublicHttpUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw AppError.validation('链接格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw AppError.validation('仅支持 http 或 https 链接');
  }
  if (url.username || url.password) {
    throw AppError.validation('链接中不能包含用户名或密码');
  }

  const hostname = normalizeHostname(url.hostname);
  const ipVersion = isIP(hostname);
  if (ipVersion > 0 && !isPublicIpAddress(hostname)) {
    throw AppError.validation('不允许访问本机、内网或保留地址');
  }
  if (
    ipVersion === 0
    && (hostname === 'localhost' || hostname.endsWith('.localhost') || !hostname.includes('.'))
  ) {
    throw AppError.validation('不允许访问本机或内部主机名');
  }
  return url;
}

/** 解析域名并确保所有返回地址均为公网地址。每次重定向都会重新调用。 */
export async function assertPublicHttpUrl(
  input: string | URL,
  resolver: HostResolver = defaultResolver,
): Promise<URL> {
  const url = parsePublicHttpUrl(input);
  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname) > 0) return url;

  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw AppError.badGateway('目标域名解析失败');
  }
  if (addresses.length === 0) throw AppError.badGateway('目标域名没有可用地址');
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw AppError.validation('目标域名解析到了本机、内网或保留地址');
  }
  return url;
}

async function readTextBodyLimited(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw AppError.badGateway(`页面响应体超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw AppError.badGateway(`页面响应体超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export interface PublicHtmlResult {
  html: string;
  finalUrl: string;
}

/**
 * 安全抓取公网 HTML：禁用自动重定向，逐跳复检目标，并流式限制解压后的响应大小。
 */
export async function fetchPublicHtml(
  input: string | URL,
  options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<PublicHtmlResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_PUBLIC_HTML_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_PUBLIC_REDIRECTS;
  let current = parsePublicHttpUrl(input);

  for (let redirects = 0; ; redirects++) {
    current = await assertPublicHttpUrl(current);
    let response: Response;
    try {
      response = await fetch(current, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw AppError.badGateway(`页面请求失败：${message}`);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      if (redirects >= maxRedirects) throw AppError.badGateway('页面重定向次数过多');
      const location = response.headers.get('location');
      if (!location) throw AppError.badGateway('页面返回了无目标的重定向');
      try {
        current = new URL(location, current);
      } catch {
        throw AppError.badGateway('页面返回了无效的重定向地址');
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw AppError.badGateway(`页面请求失败：HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase();
    if (contentType && !contentType.startsWith('text/') && !contentType.startsWith('application/xhtml+xml')) {
      await response.body?.cancel().catch(() => undefined);
      throw AppError.badGateway('目标响应不是 HTML 文本');
    }

    try {
      return { html: await readTextBodyLimited(response, maxBytes), finalUrl: current.href };
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw AppError.badGateway(`读取页面失败：${message}`);
    }
  }
}
