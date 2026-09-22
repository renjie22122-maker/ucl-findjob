import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FileSearchOutlined,
  GithubOutlined,
  PlusOutlined,
  RobotOutlined,
  ScanOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiApi, resumesApi } from '../api';
import type { GithubImportResult, ParsedResume, PolishResult, Resume, ResumeProject, ReviewResult } from '../types';
import { formatDateTime } from '../utils/constants';

const SEVERITY_COLORS = { high: 'red', medium: 'orange', low: 'default' } as const;
const SEVERITY_LABELS = { high: '高', medium: '中', low: '低' } as const;

export default function Resumes() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Resume | null>(null);
  const [previewing, setPreviewing] = useState<Resume | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['resumes'], queryFn: resumesApi.list });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => resumesApi.remove(id),
    onSuccess: () => {
      message.success('已删除');
      queryClient.invalidateQueries({ queryKey: ['resumes'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  return (
    <Card
      title="简历管理"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          新建简历
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="支持三种素材导入：粘贴文本 AI 解析、GitHub 主页导入项目、学位证/毕业证图片识别（需视觉模型）；AI 可生成简历、按岗位微调、审查打分，并与投递记录关联做岗位匹配。"
      />
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={false}
        locale={{ emptyText: '暂无简历，点击右上角新建' }}
        columns={[
          { title: '简历名称', dataIndex: 'name', width: 200 },
          { title: '目标岗位', dataIndex: 'targetRole', width: 150, render: (v) => v || '-' },
          {
            title: '内容',
            key: 'content',
            render: (_, r) => (
              <Space size={4} wrap>
                <Tag>{r.education.length} 教育</Tag>
                <Tag>{r.experience.length} 实习</Tag>
                <Tag>{r.projects.length} 项目</Tag>
                <Tag>{r.skills.length} 技能</Tag>
                {r.content && <Tag color="green">已生成全文</Tag>}
              </Space>
            ),
          },
          { title: '更新时间', dataIndex: 'updatedAt', width: 150, render: (v) => formatDateTime(v) },
          {
            title: '操作',
            key: 'actions',
            width: 300,
            render: (_, r) => (
              <Space size={4}>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    setEditorOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Button size="small" icon={<FileSearchOutlined />} onClick={() => setPreviewing(r)}>
                  预览
                </Button>
                <a href={resumesApi.exportHtmlUrl(r.id)} target="_blank" rel="noreferrer">
                  <Button size="small" icon={<ExportOutlined />}>
                    导出
                  </Button>
                </a>
                <Popconfirm title="删除该简历？关联的投递记录将解除关联" onConfirm={() => deleteMutation.mutate(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <ResumeEditorModal open={editorOpen} editing={editing} onClose={() => setEditorOpen(false)} />
      <ResumePreviewModal resume={previewing} onClose={() => setPreviewing(null)} />
    </Card>
  );
}

// ================= 编辑弹窗 =================

function ResumeEditorModal({ open, editing, onClose }: { open: boolean; editing: Resume | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [parseLoading, setParseLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubData, setGithubData] = useState<GithubImportResult | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const openFor = (resume: Resume | null) => {
    setEditingId(resume?.id ?? null);
    if (resume) {
      form.setFieldsValue({
        name: resume.name,
        targetRole: resume.targetRole,
        basic: resume.basic ?? {},
        education: resume.education,
        experience: resume.experience,
        projects: resume.projects,
        skills: resume.skills,
      });
    } else {
      form.resetFields();
    }
    setGithubData(null);
  };

  const saveMutation = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const payload: Partial<Resume> = {
        ...v,
        experience: ((v.experience as Array<Record<string, unknown>>) ?? []).map((e) => ({
          company: String(e.company ?? ''),
          role: e.role ? String(e.role) : undefined,
          start: e.start ? String(e.start) : undefined,
          end: e.end ? String(e.end) : undefined,
          description: e.description ? String(e.description).split('\n').filter(Boolean) : [],
        })),
        projects: ((v.projects as Array<Record<string, unknown>>) ?? []).map((p) => ({
          name: String(p.name ?? ''),
          role: p.role ? String(p.role) : undefined,
          link: p.link ? String(p.link) : undefined,
          tech: p.tech ? String(p.tech).split(/[,，/]/).map((t) => t.trim()).filter(Boolean) : [],
          description: p.description ? String(p.description).split('\n').filter(Boolean) : [],
        })),
      };
      return editingId ? resumesApi.update(editingId, payload) : resumesApi.create(payload);
    },
    onSuccess: () => {
      message.success('已保存');
      queryClient.invalidateQueries({ queryKey: ['resumes'] });
      onClose();
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
  });

  const handleParseText = async () => {
    const text = form.getFieldValue('_pasteText') as string | undefined;
    if (!text || text.trim().length < 20) {
      message.warning('请先粘贴至少 20 字的简历文本');
      return;
    }
    setParseLoading(true);
    try {
      const parsed: ParsedResume = await resumesApi.parseText(text.trim());
      form.setFieldsValue({
        basic: parsed.basic,
        education: parsed.education,
        experience: parsed.experience.map((e) => ({ ...e, description: e.description.join('\n') })),
        projects: parsed.projects.map((p) => ({ ...p, tech: p.tech?.join(', '), description: p.description.join('\n') })),
        skills: parsed.skills,
      });
      message.success('解析完成，已填充到表单，请核对修改');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '解析失败（需在设置页配置 LLM）');
    } finally {
      setParseLoading(false);
    }
  };

  const handleImportGithub = async () => {
    const username = form.getFieldValue('_githubUser') as string | undefined;
    if (!username?.trim()) {
      message.warning('请输入 GitHub 用户名');
      return;
    }
    setGithubLoading(true);
    try {
      const data = await resumesApi.importGithub(username.trim());
      setGithubData(data);
      // 自动填充基础信息
      const basic = form.getFieldValue('basic') ?? {};
      form.setFieldsValue({
        basic: {
          ...basic,
          name: basic.name || data.profile.name || data.profile.login,
          github: `https://github.com/${data.profile.login}`,
          blog: basic.blog || data.profile.blog || undefined,
          city: basic.city || data.profile.location || undefined,
          summary: basic.summary || data.profile.bio || undefined,
        },
      });
      message.success(`已导入主页信息与 ${data.repos.length} 个仓库（在下方勾选加入项目经历）`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'GitHub 导入失败');
    } finally {
      setGithubLoading(false);
    }
  };

  const addGithubRepos = (repos: GithubImportResult['repos']) => {
    const existing: ResumeProject[] = form.getFieldValue('projects') ?? [];
    const merged = [
      ...existing,
      ...repos.map((r) => ({
        name: r.name,
        link: r.htmlUrl,
        tech: r.language ? [r.language] : [],
        description: r.description ? [r.description] : [],
      })),
    ];
    form.setFieldsValue({ projects: merged });
    message.success(`已加入 ${repos.length} 个仓库到项目经历`);
  };

  const handlePdf = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      message.error('PDF 不能超过 5MB');
      return false;
    }
    setPdfLoading(true);
    try {
      const r = await resumesApi.parsePdf(file);
      if (r.structured) {
        form.setFieldsValue({
          basic: r.structured.basic,
          education: r.structured.education,
          experience: r.structured.experience.map((e) => ({ ...e, description: e.description.join('\n') })),
          projects: r.structured.projects.map((p) => ({ ...p, tech: p.tech?.join(', '), description: p.description.join('\n') })),
          skills: r.structured.skills,
        });
        message.success('PDF 解析完成，已填充表单，请核对修改');
      } else if (r.text) {
        form.setFieldsValue({ _pasteText: r.text });
        message.warning(r.warning ?? '未配置 LLM：已将 PDF 原文放入「粘贴文本」框，请点 AI 解析填充');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'PDF 解析失败');
    } finally {
      setPdfLoading(false);
    }
    return false;
  };

  const handleCertificate = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      message.error('图片不能超过 5MB');
      return false;
    }
    setCertLoading(true);
    try {
      const base64 = await fileToBase64(file);
      const edu = await resumesApi.parseCertificate(base64, file.type || 'image/jpeg', 'other');
      if (!edu.school && !edu.degree && !edu.major) {
        message.info('未能从图片识别出学历信息（可能是模型不支持图片或图片不清晰）');
        return false;
      }
      const list = form.getFieldValue('education') ?? [];
      form.setFieldsValue({ education: [...list, edu] });
      message.success('证书识别完成，已追加到教育经历（请核对）');
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : '识别失败（需配置支持视觉的模型，如 qwen-vl-max/GLM-4V）',
      );
    } finally {
      setCertLoading(false);
    }
    return false;
  };

  // 组件挂载/切换编辑对象时同步表单
  const [lastKey, setLastKey] = useState('');
  const key = `${open}-${editing?.id ?? 'new'}`;
  if (open && key !== lastKey) {
    setLastKey(key);
    openFor(editing);
  }

  return (
    <Modal
      title={editing ? '编辑简历' : '新建简历'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saveMutation.isPending}
      okText="保存"
      width={860}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} initialValues={{ basic: {}, education: [], experience: [], projects: [], skills: [] }}>
        <Space size="large" wrap style={{ width: '100%' }}>
          <Form.Item name="name" label="简历名称" rules={[{ required: true, message: '请输入简历名称' }]}>
            <Input placeholder="如：后端开发-2026秋招" style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="targetRole" label="目标岗位">
            <Input placeholder="如：后端开发工程师" style={{ width: 220 }} />
          </Form.Item>
        </Space>

        <Collapse
          size="small"
          defaultActiveKey={['basic']}
          items={[
            {
              key: 'basic',
              label: '基本信息',
              children: (
                <Space size="middle" wrap>
                  <Form.Item name={['basic', 'name']} label="姓名"><Input style={{ width: 140 }} /></Form.Item>
                  <Form.Item name={['basic', 'email']} label="邮箱"><Input style={{ width: 200 }} /></Form.Item>
                  <Form.Item name={['basic', 'phone']} label="电话"><Input style={{ width: 150 }} /></Form.Item>
                  <Form.Item name={['basic', 'city']} label="城市"><Input style={{ width: 110 }} /></Form.Item>
                  <Form.Item name={['basic', 'github']} label="GitHub"><Input style={{ width: 220 }} /></Form.Item>
                  <Form.Item name={['basic', 'blog']} label="个人主页"><Input style={{ width: 200 }} /></Form.Item>
                  <Form.Item name={['basic', 'summary']} label="个人简介" style={{ width: '100%' }}>
                    <Input.TextArea rows={2} placeholder="一句话概括你的优势" />
                  </Form.Item>
                </Space>
              ),
            },
            {
              key: 'edu',
              label: '教育经历',
              children: (
                <Form.List name="education">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Space key={f.key} align="baseline" wrap>
                          <Form.Item name={[f.name, 'school']} label="学校" rules={[{ required: true }]}>
                            <Input style={{ width: 160 }} />
                          </Form.Item>
                          <Form.Item name={[f.name, 'degree']} label="学位"><Input style={{ width: 90 }} /></Form.Item>
                          <Form.Item name={[f.name, 'major']} label="专业"><Input style={{ width: 120 }} /></Form.Item>
                          <Form.Item name={[f.name, 'start']} label="开始"><Input placeholder="2022-09" style={{ width: 100 }} /></Form.Item>
                          <Form.Item name={[f.name, 'end']} label="结束"><Input placeholder="2026-06" style={{ width: 100 }} /></Form.Item>
                          <Form.Item name={[f.name, 'gpa']} label="GPA"><Input style={{ width: 80 }} /></Form.Item>
                          <Button size="small" danger type="text" onClick={() => remove(f.name)}>删除</Button>
                        </Space>
                      ))}
                      <Button size="small" icon={<PlusOutlined />} onClick={() => add({ school: '' })}>添加教育经历</Button>
                    </>
                  )}
                </Form.List>
              ),
            },
            {
              key: 'exp',
              label: '实习/工作经历',
              children: (
                <Form.List name="experience">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Card key={f.key} size="small" style={{ marginBottom: 8 }}>
                          <Space align="baseline" wrap>
                            <Form.Item name={[f.name, 'company']} label="公司" rules={[{ required: true }]}>
                              <Input style={{ width: 160 }} />
                            </Form.Item>
                            <Form.Item name={[f.name, 'role']} label="职位"><Input style={{ width: 140 }} /></Form.Item>
                            <Form.Item name={[f.name, 'start']} label="开始"><Input placeholder="2025-06" style={{ width: 100 }} /></Form.Item>
                            <Form.Item name={[f.name, 'end']} label="结束"><Input placeholder="2025-09" style={{ width: 100 }} /></Form.Item>
                            <Button size="small" danger type="text" onClick={() => remove(f.name)}>删除</Button>
                          </Space>
                          <Form.Item name={[f.name, 'description']} label="工作要点（每行一条）">
                            <Input.TextArea rows={3} placeholder={'负责 XX 系统开发，QPS 提升 30%\n主导 YY 模块重构'} />
                          </Form.Item>
                        </Card>
                      ))}
                      <Button size="small" icon={<PlusOutlined />} onClick={() => add({ company: '', description: '' })}>添加实习经历</Button>
                    </>
                  )}
                </Form.List>
              ),
            },
            {
              key: 'proj',
              label: '项目经历',
              children: (
                <Form.List name="projects">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Card key={f.key} size="small" style={{ marginBottom: 8 }}>
                          <Space align="baseline" wrap>
                            <Form.Item name={[f.name, 'name']} label="项目名" rules={[{ required: true }]}>
                              <Input style={{ width: 180 }} />
                            </Form.Item>
                            <Form.Item name={[f.name, 'role']} label="角色"><Input style={{ width: 120 }} /></Form.Item>
                            <Form.Item name={[f.name, 'tech']} label="技术栈(逗号分隔)"><Input style={{ width: 200 }} /></Form.Item>
                            <Form.Item name={[f.name, 'link']} label="链接"><Input style={{ width: 200 }} /></Form.Item>
                            <Button size="small" danger type="text" onClick={() => remove(f.name)}>删除</Button>
                          </Space>
                          <Form.Item name={[f.name, 'description']} label="项目要点（每行一条）">
                            <Input.TextArea rows={2} placeholder={'实现 XX 功能，日活 10w+\n使用 Go 重构，延迟降低 40%'} />
                          </Form.Item>
                        </Card>
                      ))}
                      <Button size="small" icon={<PlusOutlined />} onClick={() => add({ name: '', description: '' })}>添加项目</Button>
                    </>
                  )}
                </Form.List>
              ),
            },
            {
              key: 'skills',
              label: '专业技能',
              children: (
                <Form.Item name="skills" label="技能（回车添加）">
                  <Select mode="tags" style={{ width: '100%' }} placeholder="如：Java、Go、MySQL、Redis、K8s" open={false} />
                </Form.Item>
              ),
            },
            {
              key: 'import',
              label: '素材导入（AI 解析 / GitHub / 证书图片）',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                  <Card size="small" title="① 粘贴简历文本，AI 解析填充表单">
                    <Form.Item name="_pasteText" noStyle>
                      <Input.TextArea rows={4} placeholder="把现有简历全文粘贴到这里（Word/网页复制均可）" />
                    </Form.Item>
                    <Button size="small" type="primary" icon={<ScanOutlined />} loading={parseLoading} onClick={handleParseText} style={{ marginTop: 8 }}>
                      AI 解析填充
                    </Button>
                  </Card>
                  <Card size="small" title="② GitHub 主页导入项目">
                    <Space>
                      <Form.Item name="_githubUser" noStyle>
                        <Input placeholder="GitHub 用户名" style={{ width: 200 }} />
                      </Form.Item>
                      <Button size="small" icon={<GithubOutlined />} loading={githubLoading} onClick={handleImportGithub}>
                        导入
                      </Button>
                    </Space>
                    {githubData && (
                      <>
                        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 6 }}>
                          {githubData.profile.name ?? githubData.profile.login}
                          {githubData.profile.bio ? ` · ${githubData.profile.bio}` : ''}，共 {githubData.repos.length} 个仓库：
                        </Typography.Paragraph>
                        <List
                          size="small"
                          style={{ maxHeight: 180, overflow: 'auto' }}
                          dataSource={githubData.repos}
                          renderItem={(r) => (
                            <List.Item>
                              <Space>
                                <Typography.Text strong>{r.name}</Typography.Text>
                                {r.language && <Tag>{r.language}</Tag>}
                                {r.stars > 0 && <Typography.Text type="secondary">⭐ {r.stars}</Typography.Text>}
                              </Space>
                            </List.Item>
                          )}
                        />
                        <Button size="small" type="primary" onClick={() => addGithubRepos(githubData.repos)}>
                          全部加入项目经历
                        </Button>
                      </>
                    )}
                  </Card>
                  <Card size="small" title="③ 学位证/毕业证图片识别（需视觉模型）">
                    <Upload accept="image/*" showUploadList={false} beforeUpload={handleCertificate} disabled={certLoading}>
                      <Button size="small" icon={<ScanOutlined />} loading={certLoading}>
                        上传证书图片识别
                      </Button>
                    </Upload>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                      默认 DeepSeek 不支持图片；需在设置页把模型换为支持视觉的（如通义 qwen-vl-max / GLM-4V）。
                    </Typography.Text>
                  </Card>
                  <Card size="small" title="④ 上传 PDF 简历解析（借鉴 Career-Search）">
                    <Upload accept=".pdf" showUploadList={false} beforeUpload={handlePdf} disabled={pdfLoading}>
                      <Button size="small" icon={<ScanOutlined />} loading={pdfLoading}>
                        上传 PDF 解析
                      </Button>
                    </Upload>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                      提取 PDF 文本后 AI 解析为结构化字段；扫描件（图片型 PDF）请改用③证书识别。
                    </Typography.Text>
                  </Card>
                </Space>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

// ================= 预览弹窗（含 AI 操作） =================

function ResumePreviewModal({ resume, onClose }: { resume: Resume | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [polishResult, setPolishResult] = useState<PolishResult | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const generateMutation = useMutation({
    mutationFn: (target?: { jobTitle?: string; company?: string }) =>
      resumesApi.generate(resume!.id, target?.jobTitle, target?.company),
    onSuccess: (r) => {
      message.success('简历已生成');
      queryClient.invalidateQueries({ queryKey: ['resumes'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '生成失败（需配置 LLM）'),
    onSettled: () => setGenerating(false),
  });

  const reviewMutation = useMutation({
    mutationFn: () => aiApi.review(resume!.id),
    onSuccess: (r) => setReview(r),
    onError: (err) => message.error(err instanceof Error ? err.message : '审查失败'),
    onSettled: () => setReviewing(false),
  });

  return (
    <Modal
      title={resume ? `预览：${resume.name}` : ''}
      open={Boolean(resume)}
      onCancel={onClose}
      width={860}
      footer={
        <Space>
          <Button
            icon={<RobotOutlined />}
            loading={generating}
            onClick={() => {
              setGenerating(true);
              generateMutation.mutate();
            }}
          >
            AI 生成简历
          </Button>
          <Button
            icon={<RobotOutlined />}
            loading={generating}
            onClick={() => {
              const jobTitle = prompt('输入目标岗位名进行微调（如：后端开发工程师）', resume?.targetRole ?? '');
              if (jobTitle) {
                setGenerating(true);
                generateMutation.mutate({ jobTitle });
              }
            }}
          >
            按岗位微调
          </Button>
          <Button
            icon={<FileSearchOutlined />}
            loading={reviewing}
            onClick={() => {
              setReviewing(true);
              setReview(null);
              reviewMutation.mutate();
            }}
          >
            AI 审查
          </Button>
          <Button
            icon={<RobotOutlined />}
            loading={polishing}
            onClick={() => {
              setPolishResult(null);
              setPolishing(true);
              aiApi
                .polish(resume!.id, resume?.targetRole ?? undefined)
                .then((r) => setPolishResult(r))
                .catch((err) => message.error(err instanceof Error ? err.message : '润色失败（需配置 LLM）'))
                .finally(() => setPolishing(false));
            }}
          >
            AI 润色建议
          </Button>
          <a href={resume ? resumesApi.exportHtmlUrl(resume.id) : '#'} target="_blank" rel="noreferrer">
            <Button icon={<ExportOutlined />}>导出 HTML/打印 PDF</Button>
          </a>
        </Space>
      }
    >
      {resume && review && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space align="center">
            <Progress type="circle" size={56} percent={review.score} format={(p) => p} />
            <div>
              <Typography.Text strong>AI 简历审查{review.ruleBased ? '（规则降级）' : ''}</Typography.Text>
              <div style={{ fontSize: 12, color: '#666' }}>{review.summary}</div>
            </div>
          </Space>
          {review.issues.length > 0 && (
            <List
              size="small"
              style={{ marginTop: 8 }}
              dataSource={review.issues}
              renderItem={(i) => (
                <List.Item>
                  <Space>
                    <Tag color={SEVERITY_COLORS[i.severity]}>{SEVERITY_LABELS[i.severity]}</Tag>
                    <Typography.Text>{i.section}：{i.advice}</Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      )}
      {resume?.content ? (
        <div className="markdown-body">
          <ReactMarkdown>{resume.content}</ReactMarkdown>
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          message="尚未生成简历全文"
          description="先点击下方「AI 生成简历」（可按岗位微调），生成后在此预览并可导出 HTML / 打印为 PDF。"
        />
      )}

      {polishResult && (
        <div style={{ marginTop: 12 }}>
          <Space align="center">
            <Typography.Text strong>AI 润色建议（当前评分 {polishResult.score}/100）</Typography.Text>
            {polishResult.keywords.length > 0 && (
              <Space size={2} wrap>
                {polishResult.keywords.map((k) => (
                  <Tag key={k} color="blue">{k}</Tag>
                ))}
              </Space>
            )}
          </Space>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '6px 0' }}>
            {polishResult.overall}
          </Typography.Paragraph>
          <List
            size="small"
            dataSource={polishResult.suggestions}
            renderItem={(s) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space>
                    <Tag color="purple">{s.section}</Tag>
                    <Typography.Text delete style={{ fontSize: 12 }}>{s.original}</Typography.Text>
                  </Space>
                  <Typography.Text style={{ fontSize: 13 }}>→ {s.improved}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>💡 {s.reason}</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}
    </Modal>
  );
}
