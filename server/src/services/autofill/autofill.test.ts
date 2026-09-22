import { describe, expect, it } from 'vitest';
import { buildFieldMapping } from './autofill.service.js';
import type { Resume } from '../resumes.service.js';

function makeResume(overrides: Partial<Resume>): Resume {
  return {
    id: 1,
    name: '测试简历',
    targetRole: '后端',
    basic: { name: '张三', email: 'zs@example.com', phone: '13800138000', city: '北京' },
    education: [{ school: '清华大学', degree: '硕士', major: '计算机科学与技术' }],
    experience: [],
    projects: [],
    skills: [],
    content: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('自动填表字段映射', () => {
  it('从简历提取表单字段', () => {
    const mapping = buildFieldMapping(makeResume({}));
    expect(mapping).toEqual({
      name: '张三',
      email: 'zs@example.com',
      phone: '13800138000',
      city: '北京',
      school: '清华大学',
      major: '计算机科学与技术',
      degree: '硕士',
    });
  });

  it('缺省字段为空值（不填充）', () => {
    const mapping = buildFieldMapping(
      makeResume({ basic: { name: '李四' }, education: [] }),
    );
    expect(mapping.name).toBe('李四');
    expect(mapping.email).toBeUndefined();
    expect(mapping.school).toBeUndefined();
    expect(mapping.phone).toBeUndefined();
  });
});
