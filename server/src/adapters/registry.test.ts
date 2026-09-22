import { describe, expect, it } from 'vitest';
import { getSourceAdapter, listSources } from './registry.js';

describe('岗位数据源注册表', () => {
  it('元数据与适配器实现来自同一注册项', () => {
    const sources = listSources();
    expect(sources.map((source) => source.id)).toContain('nowcoder');

    const adapter = getSourceAdapter('nowcoder');
    expect(adapter.info).toEqual(sources.find((source) => source.id === 'nowcoder'));
    expect(adapter.fetch).toBeTypeOf('function');
  });

  it('拒绝未注册的数据源', () => {
    expect(() => getSourceAdapter('linkedin')).toThrow('未知数据源');
  });
});
