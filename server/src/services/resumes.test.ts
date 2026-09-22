import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/connection.js';
import { createResume, buildResumeHtml, getResume, listResumes, updateResume } from './resumes.service.js';

describe('简历管理', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec('DELETE FROM resumes; DELETE FROM applications; DELETE FROM companies;');
  });

  it('创建/更新/列表/删除', () => {
    const resume = createResume({
      name: '后端开发-2026秋招',
      targetRole: '后端开发工程师',
      basic: { name: '张三', email: 'zs@example.com' },
      education: [{ school: 'XX大学', degree: '硕士', major: '计算机' }],
      skills: ['Java', 'Go'],
    });
    expect(resume.id).toBeGreaterThan(0);
    expect(resume.education).toHaveLength(1);

    updateResume(resume.id, { skills: ['Java', 'Go', 'MySQL'] });
    expect(getResume(resume.id).skills).toHaveLength(3);

    // 部分更新 basic 保留其他字段
    updateResume(resume.id, { content: '# 生成的简历' });
    const got = getResume(resume.id);
    expect(got.content).toBe('# 生成的简历');
    expect(got.basic?.email).toBe('zs@example.com');

    // nullable 字段显式传 null 时应真正清空，而不是被当作“未提供”。
    updateResume(resume.id, { targetRole: null, basic: null, content: null });
    const cleared = getResume(resume.id);
    expect(cleared.targetRole).toBeNull();
    expect(cleared.basic).toBeNull();
    expect(cleared.content).toBeNull();

    expect(listResumes()).toHaveLength(1);
  });

  it('HTML 导出包含核心信息与转义', () => {
    const resume = createResume({
      name: '测试简历',
      basic: { name: 'A<B>', summary: '简介 & 更多' },
      projects: [{ name: '项目X', description: ['做了 <b> 高亮的事'] }],
    });
    const html = buildResumeHtml(resume);
    expect(html).toContain('A&lt;B&gt;');
    expect(html).toContain('项目X');
    expect(html).toContain('&lt;b&gt;');
  });

  it('空字段容错', () => {
    const resume = createResume({ name: '空简历' });
    const html = buildResumeHtml(resume);
    expect(html).toContain('未命名简历');
    expect(getResume(resume.id).skills).toEqual([]);
  });
});
