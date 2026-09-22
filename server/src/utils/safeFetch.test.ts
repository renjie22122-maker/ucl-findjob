import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../middleware/error.js';
import {
  assertPublicHttpUrl,
  fetchPublicHtml,
  isPublicIpAddress,
  parsePublicHttpUrl,
} from './safeFetch.js';

describe('公网 URL 安全校验', () => {
  it('识别公网与非公网 IP', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('169.254.169.254')).toBe(false);
    expect(isPublicIpAddress('10.0.0.8')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false);
  });

  it.each([
    'file:///etc/passwd',
    'http://user:password@example.com/job',
    'http://localhost:3001/api/settings',
    'http://127.0.0.1/private',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/private',
    'http://intranet/job',
  ])('拒绝危险地址 %s', (url) => {
    expect(() => parsePublicHttpUrl(url)).toThrow(AppError);
  });

  it('拒绝解析到内网的域名', async () => {
    await expect(
      assertPublicHttpUrl('https://jobs.example.com/role', async () => [{ address: '192.168.1.10' }]),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('允许解析结果全部为公网地址的 HTTP(S) URL', async () => {
    const url = await assertPublicHttpUrl(
      'https://jobs.example.com/role',
      async () => [{ address: '93.184.216.34' }, { address: '2606:4700:4700::1111' }],
    );
    expect(url.href).toBe('https://jobs.example.com/role');
  });
});

describe('受限 HTML 抓取', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('逐跳复检重定向并阻止跳入内网', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPublicHtml('http://93.184.216.34/job')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('按解压后的实际字节数限制响应体', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('123456789', { status: 200, headers: { 'content-type': 'text/html' } }),
    ));

    await expect(fetchPublicHtml('http://93.184.216.34/job', { maxBytes: 8 })).rejects.toMatchObject({
      status: 502,
      code: 'UPSTREAM_ERROR',
    });
  });

  it('返回限制内的 HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<title>Backend Engineer</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    ));

    await expect(fetchPublicHtml('http://93.184.216.34/job')).resolves.toMatchObject({
      html: '<title>Backend Engineer</title>',
      finalUrl: 'http://93.184.216.34/job',
    });
  });
});
