import { z } from 'zod';
import { chatJson, chatText, chatVision } from './llm/llm.client.js';
import type { Resume, ResumeBasic, ResumeEducation, ResumeExperience, ResumeProject } from './resumes.service.js';

/**
 * AI 简历服务：文本解析 / 简历生成与岗位微调 / 审查 / 匹配打分 / 求职信。
 * 全部走 OpenAI 兼容接口（默认 DeepSeek）；未配置 Key 时：
 *  - 生成/解析/求职信 → 抛错提示配置（无法规则降级）
 *  - 审查/匹配 → 本地规则降级（低置信度标注）
 */

// ---------- 结构化 Schema ----------

const resumeStructSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  github: z.string().optional(),
  blog: z.string().optional(),
  summary: z.string().optional(),
  education: z
    .array(
      z.object({
        school: z.string(),
        degree: z.string().optional(),
        major: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        gpa: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  experience: z
    .array(
      z.object({
        company: z.string(),
        role: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        description: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  projects: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().optional(),
        link: z.string().optional(),
        tech: z.array(z.string()).optional(),
        description: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  skills: z.array(z.string()).optional(),
});

export interface ParsedResume {
  basic: ResumeBasic;
  education: ResumeEducation[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  skills: string[];
}

const PARSE_SYSTEM = `你是简历信息提取助手。从给定的简历文本中提取结构化信息，只输出 JSON。
JSON 格式：
{
  "name": "姓名", "email": "邮箱", "phone": "电话", "city": "城市", "github": "GitHub 地址", "blog": "个人主页", "summary": "一句话简介",
  "education": [{"school":"学校","degree":"学历","major":"专业","start":"开始时间","end":"结束时间","gpa":"GPA","note":"备注"}],
  "experience": [{"company":"公司","role":"职位","start":"","end":"","description":["要点1","要点2"]}],
  "projects": [{"name":"项目名","role":"角色","link":"链接","tech":["技术"],"description":["要点"]}],
  "skills": ["技能1","技能2"]
}
缺失字段用空字符串或空数组，不要编造。`;

/** 粘贴文本 → 结构化简历（需 LLM） */
export async function parseResumeText(text: string): Promise<ParsedResume> {
  const r = await chatJson(PARSE_SYSTEM, `简历文本：\n${text.slice(0, 8000)}`, resumeStructSchema, {
    temperature: 0.1,
    maxTokens: 3000,
    auditKind: 'ai',
    auditDetail: '解析粘贴的简历文本为结构化字段',
  });
  return {
    basic: {
      name: r.name || undefined,
      email: r.email || undefined,
      phone: r.phone || undefined,
      city: r.city || undefined,
      github: r.github || undefined,
      blog: r.blog || undefined,
      summary: r.summary || undefined,
    },
    education: (r.education ?? [])
      .filter((e) => e.school)
      .map((e) => ({ school: e.school, degree: e.degree, major: e.major, start: e.start, end: e.end, gpa: e.gpa, note: e.note })),
    experience: (r.experience ?? [])
      .filter((e) => e.company)
      .map((e) => ({ company: e.company, role: e.role, start: e.start, end: e.end, description: e.description ?? [] })),
    projects: (r.projects ?? [])
      .filter((p) => p.name)
      .map((p) => ({ name: p.name, role: p.role, link: p.link, tech: p.tech ?? [], description: p.description ?? [] })),
    skills: r.skills ?? [],
  };
}

/** 学位证/毕业证图片识别（需视觉模型，如 qwen-vl-max/GLM-4V；DeepSeek 文本模型不支持会返回明确错误） */
export async function parseCertificateImage(
  imageBase64: string,
  mimeType: string,
  certType: 'degree' | 'diploma' | 'other',
): Promise<Partial<ResumeEducation>> {
  const label = certType === 'degree' ? '学位证书' : certType === 'diploma' ? '毕业证书' : '证书';
  const schema = z.object({
    school: z.string(),
    degree: z.string(),
    major: z.string(),
    start: z.string(),
    end: z.string(),
    note: z.string(),
  });
  const content = await chatVision(
    `你是证书信息提取助手。从${label}图片中提取学历信息，只输出 JSON：{"school":"学校","degree":"学位","major":"专业","start":"入学时间","end":"毕业时间","note":"其他信息"}。无法识别的字段输出空字符串。`,
    '请识别图片中的证书信息。',
    imageBase64,
    mimeType,
    {
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 500,
      auditKind: 'ai',
      auditDetail: `识别${label}图片（需视觉模型）`,
    },
  );
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const r = schema.parse(JSON.parse(cleaned));
  return {
    school: r.school || undefined,
    degree: r.degree || undefined,
    major: r.major || undefined,
    start: r.start || undefined,
    end: r.end || undefined,
    note: r.note || undefined,
  };
}

/** 将简历结构化数据序列化为生成提示用文本 */
export function resumeToText(resume: Resume): string {
  const b = resume.basic ?? {};
  const parts: string[] = [];
  if (resume.targetRole) parts.push(`求职意向：${resume.targetRole}`);
  if (b.name) parts.push(`姓名：${b.name}`);
  if (b.email) parts.push(`邮箱：${b.email}`);
  if (b.phone) parts.push(`电话：${b.phone}`);
  if (b.city) parts.push(`城市：${b.city}`);
  if (b.github) parts.push(`GitHub：${b.github}`);
  if (b.summary) parts.push(`简介：${b.summary}`);
  if (resume.education.length) {
    parts.push(
      '教育经历：' +
        resume.education
          .map((e) => `${e.school} ${e.degree ?? ''} ${e.major ?? ''} ${e.start ?? ''}-${e.end ?? ''}${e.gpa ? ` GPA:${e.gpa}` : ''}`)
          .join('；'),
    );
  }
  if (resume.experience.length) {
    parts.push(
      '实习/工作经历：' +
        resume.experience
          .map((e) => `${e.company} ${e.role ?? ''}：${e.description.join('；')}`)
          .join('；'),
    );
  }
  if (resume.projects.length) {
    parts.push(
      '项目经历：' +
        resume.projects
          .map((p) => `${p.name}${p.tech?.length ? `（${p.tech.join('/')}）` : ''}：${p.description.join('；')}`)
          .join('；'),
    );
  }
  if (resume.skills.length) parts.push(`技能：${resume.skills.join('、')}`);
  return parts.join('\n');
}

const GENERATE_SYSTEM = `你是资深校招简历顾问。根据提供的简历素材生成中文简历（Markdown 格式）。
要求：结构清晰（个人信息/教育经历/实习经历/项目经历/专业技能）；描述量化成果；不使用虚假信息；突出与目标岗位相关的部分（若提供了目标岗位，将最相关内容前置并调整措辞）。`;

/** 生成简历（可选按岗位微调），需 LLM */
export async function generateResume(resume: Resume, jobTitle?: string, company?: string): Promise<string> {
  const target = jobTitle ? `目标岗位：${jobTitle}${company ? `（${company}）` : ''}` : '目标岗位：未指定，按通用校招简历生成';
  const content = await chatText(
    GENERATE_SYSTEM,
    `${target}\n\n简历素材：\n${resumeToText(resume)}\n\n请输出完整简历（Markdown）。`,
    { temperature: 0.4, maxTokens: 3000, auditKind: 'ai', auditDetail: jobTitle ? `按岗位「${jobTitle}」微调生成简历` : '生成简历' },
  );
  return content;
}

// ---------- 审查 / 匹配 / 求职信 ----------

export interface ReviewResult {
  score: number;
  issues: Array<{ severity: 'high' | 'medium' | 'low'; section: string; advice: string }>;
  summary: string;
  ruleBased: boolean;
}

const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  issues: z.array(z.object({ severity: z.enum(['high', 'medium', 'low']), section: z.string(), advice: z.string() })),
  summary: z.string(),
});

/** 简历审查：LLM 优先，规则降级 */
export async function reviewResume(resume: Resume): Promise<ReviewResult> {
  try {
    const r = await chatJson(
      '你是资深校招简历审查官。审查简历并输出 JSON：{"score": 0-100 总分, "issues": [{"severity":"high|medium|low","section":"问题所在板块","advice":"改进建议"}], "summary":"总体评价（3 句以内）"}。审查维度：排版结构、量化成果、技术栈匹配度、语言表达。',
      `简历内容：\n${resumeToText(resume)}\n${resume.content ? `\n完整简历：\n${resume.content.slice(0, 6000)}` : ''}`,
      reviewSchema,
      { temperature: 0.2, maxTokens: 1500, auditKind: 'ai', auditDetail: `审查简历「${resume.name}」` },
    );
    return { ...r, ruleBased: false };
  } catch {
    // 规则降级
    const issues: ReviewResult['issues'] = [];
    if (!resume.basic?.summary) issues.push({ severity: 'medium', section: '个人简介', advice: '缺少个人简介，建议一句话概括优势' });
    if (resume.experience.length + resume.projects.length === 0)
      issues.push({ severity: 'high', section: '经历', advice: '缺少实习/项目经历，这是校招简历的核心部分' });
    if (resume.skills.length < 3) issues.push({ severity: 'medium', section: '技能', advice: '技能条目过少，建议列出 5-8 项' });
    if (!resume.basic?.email && !resume.basic?.phone)
      issues.push({ severity: 'high', section: '个人信息', advice: '缺少联系方式（邮箱/电话）' });
    const score = Math.max(40, 100 - issues.reduce((s, i) => s + (i.severity === 'high' ? 20 : i.severity === 'medium' ? 10 : 5), 0));
    return {
      score,
      issues,
      summary: '本地规则审查（未配置 AI 或调用失败）：以上为基于字段完整性的基础检查，建议配置 LLM 获得内容质量审查。',
      ruleBased: true,
    };
  }
}

export interface MatchResult {
  score: number;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  summary: string;
  ruleBased: boolean;
}

const matchSchema = z.object({
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  suggestions: z.array(z.string()),
  summary: z.string(),
});

/** 岗位匹配打分：LLM 优先（含 JD 全文），规则降级（关键词重叠） */
export async function matchResume(
  resume: Resume,
  jobTitle: string,
  company?: string,
  jdDescription?: string | null,
  jobCity?: string | null,
): Promise<MatchResult> {
  const jdPart = jdDescription ? `\n岗位 JD：\n${jdDescription.slice(0, 2000)}` : '';
  const cityPart = jobCity ? `\n岗位城市：${jobCity}` : '';
  try {
    const r = await chatJson(
      '你是校招岗位匹配评估助手。对比简历与目标岗位（含 JD），输出 JSON：{"score": 0-100 匹配度, "strengths": ["匹配亮点"], "gaps": ["差距"], "suggestions": ["改进建议"], "summary": "总体评估"}。',
      `目标岗位：${jobTitle}${company ? `（${company}）` : ''}${cityPart}${jdPart}\n\n简历素材：\n${resumeToText(resume)}\n${resume.content ? `\n完整简历：\n${resume.content.slice(0, 6000)}` : ''}`,
      matchSchema,
      { temperature: 0.2, maxTokens: 1500, auditKind: 'ai', auditDetail: `匹配岗位「${jobTitle}」` },
    );
    return { ...r, ruleBased: false };
  } catch {
    // 规则降级：使用与全量匹配相同的结构化算法，避免把普通 JD 词汇误报为技能差距。
    const matched = structuredMatch(resume, jobTitle, jdDescription, jobCity);
    const requiredSkillCount = matched.skillHits.length + matched.skillMisses.length;
    const skillSummary = requiredSkillCount
      ? `可识别的 JD 技术要求命中 ${matched.skillHits.length}/${requiredSkillCount}`
      : 'JD 未出现可可靠识别的技术要求，技能项按中性分处理';
    const locationSummary =
      matched.cityMatch === true ? '，城市匹配' : matched.cityMatch === false ? '，城市不匹配' : '';
    return {
      score: matched.score,
      strengths: matched.skillHits.slice(0, 5).map((skill) => `简历已体现 JD 要求的「${skill}」`),
      gaps: matched.skillMisses.slice(0, 5).map((skill) => `JD 要求「${skill}」，简历暂未体现`),
      suggestions: matched.skillMisses.length
        ? [`可补充能够证明 ${matched.skillMisses.slice(0, 3).join('、')} 能力的真实经历；没有相关经历时不要虚构`]
        : ['配置 LLM 可获得内容级匹配评估（当前为结构化规则降级）'],
      summary: `结构化规则匹配：${skillSummary}${locationSummary}。`,
      ruleBased: true,
    };
  }
}

/** 求职信生成（需 LLM，无法降级） */
export async function generateCoverLetter(
  resume: Resume,
  jobTitle: string,
  company?: string,
): Promise<string> {
  return chatText(
    `你是求职者本人。基于简历素材写一封中文求职信给${company ? `「${company}」` : '目标公司'}的${jobTitle}岗位。
要求：300-500 字；开头表达对该岗位的兴趣；用 2-3 个具体经历证明匹配；结尾表达面试意愿；语气真诚不浮夸；不要编造简历中没有的经历。`,
    `简历素材：\n${resumeToText(resume)}\n${resume.content ? `\n完整简历：\n${resume.content.slice(0, 6000)}` : ''}`,
    { temperature: 0.5, maxTokens: 1500, auditKind: 'ai', auditDetail: `生成求职信（${jobTitle}）` },
  );
}

export interface BatchMatchItem {
  sourceKey?: string;
  companyName: string;
  positionTitle: string;
  jdDescription?: string | null;
  city?: string | null;
}

export interface BatchMatchResultItem extends BatchMatchItem {
  score: number;
  summary: string;
  ruleBased: boolean;
}

/**
 * 批量岗位匹配（抓取结果 → 简历匹配排序，M9 增强）。
 * 未配 LLM 时全部走规则降级，避免逐条报错。
 */
export async function matchResumeBatch(resume: Resume, items: BatchMatchItem[]): Promise<BatchMatchResultItem[]> {
  const results: BatchMatchResultItem[] = [];
  for (const item of items) {
    try {
      const r = await matchResume(resume, item.positionTitle, item.companyName, item.jdDescription, item.city);
      results.push({ ...item, score: r.score, summary: r.summary, ruleBased: r.ruleBased });
    } catch {
      results.push({ ...item, score: 0, summary: '匹配失败', ruleBased: true });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

// ---------- 结构化匹配（学历/技能/城市/岗位名，全量岗位秒级，无需 LLM） ----------

const DEGREE_RANK: Record<string, number> = {
  高中: 0,
  中专: 0,
  大专: 1,
  本科: 2,
  学士: 2,
  硕士: 3,
  研究生: 3,
  博士: 4,
};

export const DEGREE_OPTIONS = ['学历不限', '大专', '本科', '硕士', '博士'] as const;

/**
 * 仅从明确的技术词表中识别 JD 技能要求，避免把「负责」「沟通」等普通词汇当成技能差距。
 * aliases 只用于识别，结果始终返回统一的 name。
 */
const TECH_SKILL_CATALOG: ReadonlyArray<{ name: string; aliases: readonly string[] }> = [
  { name: 'Java', aliases: ['java'] },
  { name: 'Spring Boot', aliases: ['spring boot', 'springboot'] },
  { name: 'Spring', aliases: ['spring framework', 'spring mvc', 'spring'] },
  { name: 'Go', aliases: ['golang', 'go'] },
  { name: 'Python', aliases: ['python3', 'python'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'Flask', aliases: ['flask'] },
  { name: 'FastAPI', aliases: ['fastapi'] },
  { name: 'JavaScript', aliases: ['javascript', 'js'] },
  { name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { name: 'React', aliases: ['react.js', 'reactjs', 'react'] },
  { name: 'Vue', aliases: ['vue.js', 'vuejs', 'vue'] },
  { name: 'Angular', aliases: ['angular'] },
  { name: 'Node.js', aliases: ['node.js', 'nodejs'] },
  { name: 'Express', aliases: ['express.js', 'expressjs', 'express'] },
  { name: 'NestJS', aliases: ['nestjs'] },
  { name: 'C++', aliases: ['c++'] },
  { name: 'C#', aliases: ['c#'] },
  { name: '.NET', aliases: ['.net'] },
  { name: 'Kotlin', aliases: ['kotlin'] },
  { name: 'Swift', aliases: ['swift'] },
  { name: 'Rust', aliases: ['rust'] },
  { name: 'PHP', aliases: ['php'] },
  { name: 'SQL', aliases: ['sql'] },
  { name: 'MySQL', aliases: ['mysql'] },
  { name: 'PostgreSQL', aliases: ['postgresql', 'postgres'] },
  { name: 'Redis', aliases: ['redis'] },
  { name: 'MongoDB', aliases: ['mongodb'] },
  { name: 'Elasticsearch', aliases: ['elasticsearch', 'elastic search'] },
  { name: 'Kafka', aliases: ['apache kafka', 'kafka'] },
  { name: 'RabbitMQ', aliases: ['rabbitmq'] },
  { name: 'Docker', aliases: ['docker'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { name: 'AWS', aliases: ['amazon web services', 'aws'] },
  { name: 'Azure', aliases: ['microsoft azure', 'azure'] },
  { name: 'GCP', aliases: ['google cloud platform', 'gcp'] },
  { name: 'Linux', aliases: ['linux'] },
  { name: 'Git', aliases: ['git'] },
  { name: 'Jenkins', aliases: ['jenkins'] },
  { name: 'Terraform', aliases: ['terraform'] },
  { name: 'Spark', aliases: ['apache spark', 'spark'] },
  { name: 'Hadoop', aliases: ['hadoop'] },
  { name: 'Flink', aliases: ['apache flink', 'flink'] },
  { name: 'PyTorch', aliases: ['pytorch'] },
  { name: 'TensorFlow', aliases: ['tensorflow'] },
  { name: 'Pandas', aliases: ['pandas'] },
  { name: 'NumPy', aliases: ['numpy'] },
  { name: 'OpenCV', aliases: ['opencv'] },
  { name: 'LLM', aliases: ['large language model', '大语言模型', 'llm'] },
  { name: 'RAG', aliases: ['检索增强生成', 'rag'] },
  { name: 'LangChain', aliases: ['langchain'] },
  { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'gRPC', aliases: ['grpc'] },
];

function textMentionsTech(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leftBoundary = /^[a-z0-9]/i.test(alias) ? '(?:^|[^a-z0-9])' : '';
  const rightBoundary = /[a-z0-9]$/i.test(alias) ? '(?=$|[^a-z0-9])' : '';
  return new RegExp(`${leftBoundary}${escaped}${rightBoundary}`, 'i').test(text);
}

function extractTechSkills(text: string): string[] {
  const found = TECH_SKILL_CATALOG.filter((skill) => skill.aliases.some((alias) => textMentionsTech(text, alias))).map(
    (skill) => skill.name,
  );
  // 更具体的框架名出现时不重复报告其父级词。
  return found.filter((skill) => !(skill === 'Spring' && found.includes('Spring Boot')));
}

/** 简历最高学历等级 */
export function resumeDegreeRank(resume: Resume): number {
  let rank = 0;
  for (const edu of resume.education) {
    const r = DEGREE_RANK[edu.degree ?? ''] ?? 0;
    if (r > rank) rank = r;
  }
  return rank;
}

/** 从 JD 文本提取学历要求 */
export function extractEducationRequirement(text: string): (typeof DEGREE_OPTIONS)[number] | null {
  if (/学历不限|专业不限/.test(text)) return '学历不限';
  if (/博士/.test(text)) return '博士';
  if (/硕士|研究生/.test(text)) return '硕士';
  if (/本科/.test(text)) return '本科';
  if (/大专/.test(text)) return '大专';
  return null;
}

export interface StructuredMatch {
  score: number;
  educationReq: (typeof DEGREE_OPTIONS)[number] | null;
  educationMatch: boolean | null; // null = JD 未提学历要求
  skillHits: string[];
  skillMisses: string[]; // JD 明确要求、但简历未体现的技能（字段名保留以兼容现有 API）
  cityMatch: boolean | null; // null = 岗位/简历未填城市
  titleHit: boolean;
}

/** 结构化匹配：学历 + 技能 + 城市 + 岗位名关键词（0-100，确定性算法） */
export function structuredMatch(
  resume: Resume,
  jobTitle: string,
  jdDescription?: string | null,
  jobCity?: string | null,
): StructuredMatch {
  const jd = jdDescription ?? '';
  const haystack = `${jobTitle} ${jd}`.toLowerCase();

  // 学历：简历最高学历 vs JD 要求
  const educationReq = extractEducationRequirement(`${jobTitle} ${jd}`);
  const myRank = resumeDegreeRank(resume);
  let educationMatch: boolean | null = null;
  if (educationReq && educationReq !== '学历不限') {
    const reqRank = DEGREE_RANK[educationReq] ?? 2;
    educationMatch = myRank >= reqRank;
  }

  // 技能差距以 JD 为基准：只报告 JD 中实际出现的常见技术词，不把简历的额外技能误称为缺口。
  const requiredSkills = extractTechSkills(haystack);
  // 对词表外的简历技能，仅在 JD 明确原样提及时作为命中项；不会据此虚构缺失项。
  for (const skill of resume.skills.map((item) => item.trim()).filter((item) => item.length >= 2)) {
    if (textMentionsTech(haystack, skill) && !requiredSkills.some((item) => item.toLowerCase() === skill.toLowerCase())) {
      requiredSkills.push(skill);
    }
  }
  const resumeText = `${resumeToText(resume)} ${resume.content ?? ''}`;
  const resumeTechSkills = new Set(extractTechSkills(resumeText));
  const skillHits = requiredSkills.filter((skill) =>
    resumeTechSkills.has(skill) || textMentionsTech(resumeText, skill),
  );
  const skillMisses = requiredSkills.filter((skill) => !skillHits.includes(skill));

  // 城市
  const resumeCity = (resume.basic?.city ?? '').trim();
  let cityMatch: boolean | null = null;
  if (resumeCity && jobCity) cityMatch = jobCity.includes(resumeCity) || resumeCity.includes(jobCity);

  // 岗位名关键词是否出现在简历中
  const titleTokens = jobTitle.toLowerCase().split(/[\s/·()（）\-]+/).filter((t) => t.length >= 2);
  const normalizedResumeText = resumeText.toLowerCase();
  const titleHit = titleTokens.length > 0 && titleTokens.filter((t) => normalizedResumeText.includes(t)).length / titleTokens.length >= 0.4;

  // 计分（0-100）
  let score = 0;
  if (educationMatch === true) score += 25;
  else if (educationMatch === null) score += 15;
  if (requiredSkills.length > 0) {
    score += Math.min(50, Math.round((skillHits.length / requiredSkills.length) * 50));
  } else {
    score += 25; // JD 未出现可可靠识别的技术要求时保持中性
  }
  if (cityMatch === true) score += 10;
  else if (cityMatch === null) score += 5;
  if (titleHit) score += 10;
  if (educationMatch === false) score = Math.min(score, 40); // 学历硬伤封顶

  return { score: Math.min(100, score), educationReq, educationMatch, skillHits, skillMisses, cityMatch, titleHit };
}

import { getDb } from '../db/connection.js';

export interface MatchAllItem {
  applicationId: number;
  companyName: string;
  positionTitle: string;
  status: string;
  jobType: string;
  city: string | null;
  channel: string | null;
  deadline: string | null;
  jdUrl: string | null;
  score: number;
  educationReq: StructuredMatch['educationReq'];
  educationMatch: boolean | null;
  skillHits: string[];
  skillMisses: string[];
  cityMatch: boolean | null;
}

/** 全量岗位结构化匹配（按分数降序） */
export function matchAllApplications(resume: Resume): MatchAllItem[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.position_title, a.job_type, a.channel, a.deadline, a.jd_url, a.status, a.jd_description,
              c.name AS company_name, c.city AS city
       FROM applications a JOIN companies c ON c.id = a.company_id
       ORDER BY a.updated_at DESC`,
    )
    .all() as Array<{
    id: number;
    position_title: string;
    job_type: string;
    channel: string | null;
    deadline: string | null;
    jd_url: string | null;
    status: string;
    jd_description: string | null;
    company_name: string;
    city: string | null;
  }>;

  const items = rows.map((row) => {
    const m = structuredMatch(resume, row.position_title, row.jd_description, row.city);
    return {
      applicationId: row.id,
      companyName: row.company_name,
      positionTitle: row.position_title,
      status: row.status,
      jobType: row.job_type,
      city: row.city,
      channel: row.channel,
      deadline: row.deadline,
      jdUrl: row.jd_url,
      score: m.score,
      educationReq: m.educationReq,
      educationMatch: m.educationMatch,
      skillHits: m.skillHits,
      skillMisses: m.skillMisses,
      cityMatch: m.cityMatch,
    };
  });
  return items.sort((a, b) => b.score - a.score);
}

// ---------- AI 面试题（借鉴 Career-Search 提示词设计） ----------

export interface InterviewQuestion {
  question: string;
  category: '技术' | '业务' | '行为' | '情景';
  difficulty: '简单' | '中等' | '困难';
  tips: string;
  sample: string;
}

const interviewSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      category: z.enum(['技术', '业务', '行为', '情景']),
      difficulty: z.enum(['简单', '中等', '困难']),
      tips: z.string(),
      sample: z.string(),
    }),
  ),
});

/** 岗位定制面试题（8-10 道 + 参考答案） */
export async function generateInterviewQuestions(
  resume: Resume,
  jobTitle: string,
  company?: string,
  jdDescription?: string | null,
): Promise<{ questions: InterviewQuestion[] }> {
  const r = await chatJson(
    `你是一个资深面试官。根据候选人背景和目标岗位，生成针对性面试题。
返回 JSON：{"questions":[{"question":"面试题","category":"技术|业务|行为|情景","difficulty":"简单|中等|困难","tips":"回答要点提示（50-100字）","sample":"参考答案要点（100-200字，结构化回答）"}]}
生成 8-10 道题，覆盖技术能力、业务理解、行为面试、情景模拟。题目要具体，不要泛泛而谈。sample 必须是详细的参考答案，不是简单提示。`,
    `目标岗位：${jobTitle}${company ? `（${company}）` : ''}\n${jdDescription ? `岗位 JD：\n${jdDescription.slice(0, 2000)}` : ''}\n\n候选人简历：\n${resumeToText(resume)}\n${resume.content ? `\n完整简历：\n${resume.content.slice(0, 6000)}` : ''}`,
    interviewSchema,
    { temperature: 0.5, maxTokens: 3000, auditKind: 'ai', auditDetail: `生成面试题（${jobTitle}）` },
  );
  return { questions: r.questions };
}

// ---------- AI 简历润色（STAR 法则 + ATS 关键词） ----------

export interface PolishSuggestion {
  section: string;
  original: string;
  improved: string;
  reason: string;
}

export interface PolishResult {
  suggestions: PolishSuggestion[];
  overall: string;
  keywords: string[];
  score: number;
}

const polishSchema = z.object({
  suggestions: z.array(
    z.object({ section: z.string(), original: z.string(), improved: z.string(), reason: z.string() }),
  ),
  overall: z.string(),
  keywords: z.array(z.string()),
  score: z.number().min(0).max(100),
});

/** 简历润色：逐条 before/after 建议 + 关键词 + 评分 */
export async function polishResume(resume: Resume, jobTitle?: string): Promise<PolishResult> {
  return chatJson(
    `你是简历优化专家。根据候选人背景${jobTitle ? `和目标岗位「${jobTitle}」` : ''}，对每段经历给出具体润色建议。
返回 JSON：
{"suggestions":[{"section":"所属板块（实习经历/项目经历/技能/教育背景等）","original":"简历原文（逐句提取实际文字）","improved":"优化后描述（STAR 法则，含技术细节与量化成果）","reason":"为什么这样改"}],
 "overall":"整体建议", "keywords":["应突出的 ATS 关键词"], "score":75}
规则：suggestions 按重要性降序，必须逐句分析原文；improved 必须包含具体技术栈与量化数据；不要编造简历中没有的经历。`,
    `简历素材：\n${resumeToText(resume)}\n${resume.content ? `\n完整简历：\n${resume.content.slice(0, 6000)}` : ''}`,
    polishSchema,
    { temperature: 0.4, maxTokens: 3000, auditKind: 'ai', auditDetail: jobTitle ? `润色简历（目标岗位 ${jobTitle}）` : '润色简历' },
  );
}

// ---------- AI 面试记录解析（自然语言 → 结构化） ----------

export interface ParsedInterview {
  round: string;
  questions: string[];
  feeling: string;
  result: string;
  suggestions: string[];
}

const interviewRecordSchema = z.object({
  round: z.string(),
  questions: z.array(z.string()),
  feeling: z.string(),
  result: z.string(),
  suggestions: z.array(z.string()),
});

/** 面试记录自然语言解析（LLM 优先，规则降级） */
export async function parseInterviewRecord(text: string): Promise<ParsedInterview & { ruleBased: boolean }> {
  try {
    const r = await chatJson(
      `你是面试记录整理助手。把候选人自然语言描述的面试经历解析为结构化记录，只输出 JSON：
{"round":"面试轮次（一面/二面/HR面/笔试等）","questions":["被问到的问题"],"feeling":"整体感受","result":"结果","suggestions":["复盘建议"]}
无法判断的字段输出空字符串或空数组。`,
      `面试记录原文：\n${text.slice(0, 4000)}`,
      interviewRecordSchema,
      { temperature: 0.2, maxTokens: 1500, auditKind: 'ai', auditDetail: '解析面试记录为结构化笔记' },
    );
    return { ...r, ruleBased: false };
  } catch {
    return {
      round: text.includes('HR') || text.includes('hr') ? 'HR面' : text.includes('笔试') ? '笔试' : '面试',
      questions: [],
      feeling: '',
      result: '',
      suggestions: ['未配置 LLM，仅按关键词规则归档（建议配置后重新解析）'],
      ruleBased: true,
    };
  }
}

// ---------- AI Offer 对比 ----------

export interface OfferCompareItem {
  company: string;
  positionTitle: string;
  note: string | null;
}

export interface OfferCompareResult {
  comparison: Array<{ company: string; positionTitle: string; pros: string[]; cons: string[]; score: number }>;
  recommendation: string;
  salaryAdvice: string;
  summary: string;
}

const offerCompareSchema = z.object({
  comparison: z.array(
    z.object({ company: z.string(), positionTitle: z.string(), pros: z.array(z.string()), cons: z.array(z.string()), score: z.number().min(0).max(100) }),
  ),
  recommendation: z.string(),
  salaryAdvice: z.string(),
  summary: z.string(),
});

/** Offer 对比（需 LLM；未配置时返回模板降级） */
export async function compareOffers(items: OfferCompareItem[]): Promise<OfferCompareResult & { ruleBased: boolean }> {
  try {
    const r = await chatJson(
      `你是求职顾问。对比多个 Offer 并给出建议，输出 JSON：
{"comparison":[{"company":"公司","positionTitle":"岗位","pros":["优势"],"cons":["劣势"],"score":0-100}],
 "recommendation":"综合推荐哪个及理由","salaryAdvice":"谈薪建议","summary":"一句话总结"}
结合行业、发展、薪资（如备注中有）、城市、稳定性等维度。`,
      `Offer 列表：\n${items.map((i) => `- ${i.company} · ${i.positionTitle}${i.note ? `（备注：${i.note.slice(0, 500)}）` : ''}`).join('\n')}`,
      offerCompareSchema,
      { temperature: 0.3, maxTokens: 2000, auditKind: 'ai', auditDetail: `对比 ${items.length} 个 Offer` },
    );
    return { ...r, ruleBased: false };
  } catch {
    return {
      comparison: items.map((i) => ({
        company: i.company,
        positionTitle: i.positionTitle,
        pros: [],
        cons: [],
        score: 50,
      })),
      recommendation: '未配置 LLM，无法给出 AI 对比建议。请配置 DeepSeek Key 后重试。',
      salaryAdvice: '',
      summary: '',
      ruleBased: true,
    };
  }
}

// ---------- 投递清单（匹配度 × 紧急度，Career-Search 核心功能「今天该投哪家」） ----------

export interface ActionListItem extends MatchAllItem {
  urgency: number; // 0-30：截止日期临近程度
  actionScore: number; // 0-100：综合分 = 匹配度*0.7 + 紧急度归一
}

/** 紧急度（纯函数）：7 天内截止 30，30 天内 20，其余 0 */
export function deadlineUrgency(deadline: string | null, now = new Date()): number {
  if (!deadline) return 0;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime()) || d.getTime() < now.getTime()) return 0;
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400_000);
  if (days <= 7) return 30;
  if (days <= 30) return 20;
  return 0;
}

/** 本周投递清单：仅待投递岗位按 匹配度*0.7 + 紧急度 排序，Top N */
export function buildActionList(resume: Resume, topN = 20): ActionListItem[] {
  const matched = matchAllApplications(resume);
  return matched
    .filter((m) => m.status === 'WISHLIST')
    .map((m) => {
      const urgency = deadlineUrgency(m.deadline);
      return { ...m, urgency, actionScore: Math.round(m.score * 0.7 + urgency) };
    })
    .sort((a, b) => b.actionScore - a.actionScore)
    .slice(0, topN);
}
