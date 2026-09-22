/** 招聘相关邮件初筛关键词（文档 04 §3.8） */
const RECRUITMENT_KEYWORDS = [
  '面试',
  '笔试',
  '测评',
  '评估',
  'offer',
  'OFFER',
  'Offer',
  '录用',
  '感谢信',
  '简历',
  '内推',
  '投递',
  '校招',
  '实习',
  '春招',
  '秋招',
  '性格测试',
  '在线考试',
];

export function isRecruitmentCandidate(subject: string, sender: string): boolean {
  const haystack = `${subject} ${sender}`;
  return RECRUITMENT_KEYWORDS.some((k) => haystack.includes(k));
}
