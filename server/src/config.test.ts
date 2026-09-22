import { describe, expect, it } from 'vitest';
import { resolveHost } from './config.js';

describe('服务监听地址', () => {
  it('未配置或空白 HOST 时仅监听回环地址', () => {
    expect(resolveHost(undefined)).toBe('127.0.0.1');
    expect(resolveHost('   ')).toBe('127.0.0.1');
  });

  it('显式 HOST 配置会被保留', () => {
    expect(resolveHost(' 0.0.0.0 ')).toBe('0.0.0.0');
    expect(resolveHost('::1')).toBe('::1');
  });
});
