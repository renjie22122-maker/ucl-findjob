import { describe, expect, it } from 'vitest';
import { buildResumeHtml, type Resume } from './resumes.service.js';

function makeResume(overrides: Partial<Resume> = {}): Resume {
  return {
    id: 1,
    name: '测试简历',
    targetRole: null,
    basic: null,
    education: [],
    experience: [],
    projects: [],
    skills: [],
    content: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('简历 HTML 安全输出', () => {
  it('转义文本和属性中的引号', () => {
    const html = buildResumeHtml(makeResume({
      basic: { name: 'A"<script>alert(1)</script>' },
      projects: [{
        name: '项目',
        link: 'https://example.com/job?name=" onmouseover="alert(1)',
        description: [],
      }],
    }));

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onmouseover="alert(1)');
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('只把 http/https 项目地址渲染为链接', () => {
    const html = buildResumeHtml(makeResume({
      projects: [
        { name: '安全项目', link: 'https://example.com/project', description: [] },
        { name: '危险项目', link: 'javascript:alert(1)', description: [] },
      ],
    }));

    expect(html).toContain('href="https://example.com/project"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('javascript:alert(1)');
  });
});
