import { Button, Card, Col, Descriptions, Form, Input, List, Modal, Popconfirm, Progress, Result, Row, Select, Space, Typography, message, DatePicker } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, FormOutlined, PlusOutlined, IdcardOutlined, RobotOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiApi, applicationsApi, autofillApi, remindersApi, resumesApi } from '../api';
import StatusTag from '../components/StatusTag';
import TransitionButton from '../components/TransitionButton';
import AppTimeline from '../components/AppTimeline';
import ApplicationFormModal from '../components/ApplicationFormModal';
import { JOB_TYPE_LABELS, PRIORITY_LABELS, PRIORITY_COLORS, REMINDER_TYPE_LABELS, formatDateTime } from '../utils/constants';
import dayjs from 'dayjs';
import type { InterviewQuestion, MatchResult, Reminder } from '../types';
import { Tag } from 'antd';
import ReactMarkdown from 'react-markdown';
import { Collapse } from 'antd';

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const appId = Number(id);
  const hasValidAppId = Number.isInteger(appId) && appId > 0;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [noteForm] = Form.useForm();
  const [reminderForm] = Form.useForm();

  const { data, error, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ['applications', appId],
    queryFn: () => applicationsApi.get(appId),
    enabled: hasValidAppId,
  });

  const { data: remindersData } = useQuery({
    queryKey: ['reminders', appId],
    queryFn: () => remindersApi.list(),
    enabled: hasValidAppId,
  });
  const reminders = (remindersData?.items ?? []).filter((r) => r.applicationId === appId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['reminders'] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => applicationsApi.remove(appId),
    onSuccess: () => {
      message.success('已删除');
      invalidate();
      navigate('/applications');
    },
  });

  const noteMutation = useMutation({
    mutationFn: (v: { title: string; description?: string }) => applicationsApi.addNote(appId, v),
    onSuccess: () => {
      message.success('笔记已添加');
      setNoteOpen(false);
      noteForm.resetFields();
      invalidate();
    },
  });

  const reminderMutation = useMutation({
    mutationFn: (v: { type: Reminder['type']; title: string; scheduledAt: string }) =>
      remindersApi.create({ applicationId: appId, ...v }),
    onSuccess: () => {
      message.success('提醒已创建');
      setReminderOpen(false);
      reminderForm.resetFields();
      invalidate();
    },
  });

  const doneMutation = useMutation({
    mutationFn: (r: Reminder) => remindersApi.setDone(r.id, !r.done),
    onSuccess: () => invalidate(),
  });

  // ---- 简历与 AI ----
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  const [coverLetter, setCoverLetter] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [quickApplied, setQuickApplied] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [parsingNote, setParsingNote] = useState(false);
  const [rawNote, setRawNote] = useState('');

  const handleAutofill = async () => {
    setAutofilling(true);
    try {
      const targetUrl = prompt(
        '自动填表助手将打开投递页并填充表单（需要已关联简历）。\n留空使用 JD 链接，或粘贴自定义投递页 URL：',
        app.jdUrl ?? '',
      );
      if (targetUrl === null) return; // 用户取消
      const result = await autofillApi.fill(app.id, targetUrl.trim() || undefined);
      message.success(result.message);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '自动填表失败');
    } finally {
      setAutofilling(false);
    }
  };

  const { data: resumesData } = useQuery({ queryKey: ['resumes'], queryFn: resumesApi.list });
  const resumes = resumesData?.items ?? [];

  const resumeLinkMutation = useMutation({
    mutationFn: (resumeId: number | null) => applicationsApi.update(appId, { resumeId }),
    onSuccess: () => {
      message.success('已关联简历版本');
      invalidate();
    },
  });

  const matchMutation = useMutation({
    mutationFn: (resumeId: number) => aiApi.match(resumeId, appId),
    onSuccess: (r) => setMatchResult(r),
    onError: (err) => message.error(err instanceof Error ? err.message : '匹配失败'),
    onSettled: () => setMatching(false),
  });

  const coverLetterMutation = useMutation({
    mutationFn: (resumeId: number) => aiApi.coverLetter(resumeId, appId),
    onSuccess: (r) => setCoverLetter(r.content),
    onError: (err) => message.error(err instanceof Error ? err.message : '生成失败（需配置 LLM）'),
    onSettled: () => setCoverLoading(false),
  });

  if (!hasValidAppId) {
    return (
      <Result
        status="404"
        title="无效的投递编号"
        subTitle="请从投递列表重新选择一条记录。"
        extra={<Button type="primary" onClick={() => navigate('/applications')}>返回投递列表</Button>}
      />
    );
  }

  if (isLoading) {
    return <Card loading><span role="status">正在加载投递详情…</span></Card>;
  }

  if (isError) {
    return (
      <Result
        status="error"
        title="无法加载投递详情"
        subTitle={error instanceof Error ? error.message : '请求失败，请稍后重试。'}
        extra={[
          <Button key="retry" type="primary" loading={isFetching} onClick={() => void refetch()}>重新加载</Button>,
          <Button key="back" onClick={() => navigate('/applications')}>返回投递列表</Button>,
        ]}
      />
    );
  }

  if (!data) {
    return (
      <Result
        status="404"
        title="未找到这条投递"
        subTitle="该记录可能已被删除。"
        extra={<Button type="primary" onClick={() => navigate('/applications')}>返回投递列表</Button>}
      />
    );
  }
  const app = data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} aria-label="返回投递列表" onClick={() => navigate('/applications')} />
            <span>
              {app.companyName} · {app.positionTitle}
            </span>
            <StatusTag status={app.status} />
            <Tag color={PRIORITY_COLORS[app.priority]}>{PRIORITY_LABELS[app.priority]}</Tag>
          </Space>
        }
        extra={
          <Space>
            <TransitionButton applicationId={app.id} status={app.status} size="middle" />
            <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
              编辑
            </Button>
            <Popconfirm title="确认删除该投递记录及其时间线/提醒？" onConfirm={() => deleteMutation.mutate()}>
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Descriptions column={{ xs: 1, md: 2, lg: 3 }} size="small">
          <Descriptions.Item label="类型">{JOB_TYPE_LABELS[app.jobType]}</Descriptions.Item>
          <Descriptions.Item label="渠道">{app.channel || '-'}</Descriptions.Item>
          <Descriptions.Item label="投递日期">{app.appliedAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="截止日期">{app.deadline ? formatDateTime(app.deadline) : '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatDateTime(app.updatedAt)}</Descriptions.Item>
          <Descriptions.Item label="JD 链接">
            {app.jdUrl ? (
              <a href={app.jdUrl} target="_blank" rel="noreferrer">
                打开链接
              </a>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>
            {app.note || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title={
          <Space>
            <RobotOutlined /> 简历与 AI
          </Space>
        }
        size="small"
      >
        <Space wrap>
          <Select
            placeholder="关联简历版本"
            style={{ width: 220 }}
            allowClear
            value={app.resumeId ?? undefined}
            onChange={(v) => resumeLinkMutation.mutate(v ?? null)}
            options={resumes.map((r) => ({ value: r.id, label: r.name }))}
            notFoundContent={
              <Button type="link" size="small" onClick={() => navigate('/resumes')}>
                去简历管理创建
              </Button>
            }
          />
          <Button
            icon={<RobotOutlined />}
            loading={matching}
            onClick={() => {
              const resumeId = app.resumeId ?? resumes[0]?.id;
              if (!resumeId) {
                message.warning('请先关联一份简历（可在简历管理页创建）');
                return;
              }
              setMatchResult(null);
              setMatching(true);
              matchMutation.mutate(resumeId);
            }}
          >
            AI 岗位匹配打分
          </Button>
          <Button
            icon={<RobotOutlined />}
            loading={questionsLoading}
            onClick={() => {
              const resumeId = app.resumeId ?? resumes[0]?.id;
              if (!resumeId) {
                message.warning('请先关联一份简历');
                return;
              }
              setQuestions(null);
              setQuestionsLoading(true);
              aiApi
                .interviewQuestions(resumeId, app.id)
                .then((r) => setQuestions(r.questions))
                .catch((err) => message.error(err instanceof Error ? err.message : '生成失败（需配置 LLM）'))
                .finally(() => setQuestionsLoading(false));
            }}
          >
            AI 面试题
          </Button>
          <Button
            icon={<RobotOutlined />}
            loading={coverLoading}
            onClick={() => {
              const resumeId = app.resumeId ?? resumes[0]?.id;
              if (!resumeId) {
                message.warning('请先关联一份简历');
                return;
              }
              setCoverLetter(null);
              setCoverLoading(true);
              coverLetterMutation.mutate(resumeId);
            }}
          >
            生成定制求职信
          </Button>
          {app.jdUrl && (
            <a href={app.jdUrl} target="_blank" rel="noreferrer">
              <Button size="small">打开 JD 原链接</Button>
            </a>
          )}
        </Space>

        {matchResult && (
          <Card size="small" style={{ marginTop: 12 }}>
            <Space align="center">
              <Progress
                type="circle"
                size={64}
                percent={matchResult.score}
                format={(p) => p}
                status={matchResult.score >= 70 ? 'success' : matchResult.score >= 50 ? 'normal' : 'exception'}
              />
              <div>
                <Typography.Text strong>
                  匹配度 {matchResult.score}/100{matchResult.ruleBased ? '（规则降级）' : ''}
                </Typography.Text>
                <div style={{ fontSize: 12, color: '#666' }}>{matchResult.summary}</div>
              </div>
            </Space>
            {matchResult.strengths.length > 0 && (
              <>
                <Typography.Text strong>✅ 匹配亮点</Typography.Text>
                <List size="small" dataSource={matchResult.strengths} renderItem={(s) => <List.Item>{s}</List.Item>} />
              </>
            )}
            {matchResult.gaps.length > 0 && (
              <>
                <Typography.Text strong>⚠️ 差距</Typography.Text>
                <List size="small" dataSource={matchResult.gaps} renderItem={(s) => <List.Item>{s}</List.Item>} />
              </>
            )}
            {matchResult.suggestions.length > 0 && (
              <>
                <Typography.Text strong>💡 建议</Typography.Text>
                <List size="small" dataSource={matchResult.suggestions} renderItem={(s) => <List.Item>{s}</List.Item>} />
              </>
            )}
          </Card>
        )}
      </Card>

      {app.status === 'WISHLIST' && (
        <Card
          title={
            <Space>
              <IdcardOutlined /> 投递行动卡
            </Space>
          }
          size="small"
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text>投递准备清单：</Typography.Text>
            <Space wrap>
              <Tag color={app.resumeId ? 'green' : 'orange'}>简历 {app.resumeId ? '✅ 已关联' : '⚠️ 未关联'}</Tag>
              <Tag>成绩单扫描件</Tag>
              <Tag>证书扫描件</Tag>
              <Tag>内推码（如有）</Tag>
            </Space>
            <Space wrap>
              {app.jdUrl && (
                <a href={app.jdUrl} target="_blank" rel="noreferrer">
                  <Button type="primary">打开官网投递页</Button>
                </a>
              )}
              <Button
                icon={<FormOutlined />}
                loading={autofilling}
                onClick={handleAutofill}
              >
                自动填表助手
              </Button>
              <Button
                loading={quickApplied}
                onClick={() => {
                  setQuickApplied(true);
                  applicationsApi
                    .transition(app.id, { toStatus: 'APPLIED', note: '已完成投递（行动卡快捷标记）' })
                    .then(() =>
                      applicationsApi.update(app.id, {
                        appliedAt: dayjs().format('YYYY-MM-DD'),
                        channel: app.channel ?? '官网',
                      }),
                    )
                    .then(() => {
                      message.success('已标记为「已投递」，投递日期已记录');
                      invalidate();
                    })
                    .catch((err) => message.error(err instanceof Error ? err.message : '操作失败'))
                    .finally(() => setQuickApplied(false));
                }}
              >
                已投递，标记状态
              </Button>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              辅助投递模式：自动填表助手会打开投递页并按关联简历填充常见字段（姓名/邮箱/电话/学校/专业/学历），请人工核对后自行点击提交——投递提交永远由你完成（合规要求，不做全自动投递）。
            </Typography.Text>
          </Space>
        </Card>
      )}

      <Row gutter={16}>
        <Col xs={24} md={14}>
          <Card
            title="时间线"
            size="small"
            extra={
              <Button size="small" icon={<PlusOutlined />} onClick={() => setNoteOpen(true)}>
                追加笔记
              </Button>
            }
          >
            <AppTimeline events={data.timeline} />
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card
            title="提醒"
            size="small"
            extra={
              <Button size="small" icon={<PlusOutlined />} onClick={() => setReminderOpen(true)}>
                新建提醒
              </Button>
            }
          >
            {reminders.length === 0 && <Typography.Text type="secondary">暂无提醒</Typography.Text>}
            <Space direction="vertical" style={{ width: '100%' }}>
              {reminders.map((r) => (
                <Card
                  key={r.id}
                  size="small"
                  style={r.done ? { opacity: 0.5 } : undefined}
                  onClick={() => doneMutation.mutate(r)}
                  hoverable
                >
                  <Space direction="vertical" size={2}>
                    <Space>
                      <Tag>{REMINDER_TYPE_LABELS[r.type]}</Tag>
                      <Typography.Text delete={Boolean(r.done)}>{r.title}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTime(r.scheduledAt)} {r.done ? '· 已完成' : '· 点击标记完成'}
                    </Typography.Text>
                  </Space>
                </Card>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <ApplicationFormModal open={editOpen} onClose={() => setEditOpen(false)} editing={app} />

      <Modal
        title="追加笔记"
        open={noteOpen}
        onCancel={() => setNoteOpen(false)}
        onOk={() => noteForm.submit()}
        confirmLoading={noteMutation.isPending}
        destroyOnClose
      >
        <Form form={noteForm} layout="vertical" onFinish={(v) => noteMutation.mutate(v)}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：内推人反馈进入简历池" />
          </Form.Item>
          <Form.Item name="description" label="内容">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="面试记录 AI 解析（可选）">
            <Input.TextArea
              rows={3}
              placeholder="把面试原始描述粘贴到这里，如：今天字节二面问了Redis持久化，答得一般，感觉要挂…"
              value={rawNote}
              onChange={(e) => setRawNote(e.target.value)}
            />
            <Button
              size="small"
              icon={<RobotOutlined />}
              loading={parsingNote}
              style={{ marginTop: 6 }}
              onClick={async () => {
                if (rawNote.trim().length < 10) {
                  message.warning('请先粘贴面试原始描述');
                  return;
                }
                setParsingNote(true);
                try {
                  const r = await aiApi.parseInterview(rawNote.trim());
                  noteForm.setFieldsValue({
                    title: `面试记录：${r.round}`,
                    description: [
                      r.questions.length ? `被问到：${r.questions.join('；')}` : null,
                      r.feeling ? `感受：${r.feeling}` : null,
                      r.result ? `结果：${r.result}` : null,
                      r.suggestions.length ? `复盘：${r.suggestions.join('；')}` : null,
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  });
                  message.success(`已解析为「${r.round}」结构化笔记${r.ruleBased ? '（规则降级，配置 LLM 效果更好）' : ''}`);
                } catch (err) {
                  message.error(err instanceof Error ? err.message : '解析失败');
                } finally {
                  setParsingNote(false);
                }
              }}
            >
              AI 解析为结构化笔记
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建提醒"
        open={reminderOpen}
        onCancel={() => setReminderOpen(false)}
        onOk={() => reminderForm.submit()}
        confirmLoading={reminderMutation.isPending}
        destroyOnClose
      >
        <Form
          form={reminderForm}
          layout="vertical"
          initialValues={{ type: 'interview' }}
          onFinish={(v) =>
            reminderMutation.mutate({
              ...v,
              scheduledAt: (v.scheduledAt as dayjs.Dayjs).format('YYYY-MM-DDTHH:mm:ss'),
            })
          }
        >
          <Form.Item name="type" label="类型">
            <Select
              options={Object.entries(REMINDER_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：一面面试" />
          </Form.Item>
          <Form.Item name="scheduledAt" label="提醒时间" rules={[{ required: true, message: '请选择时间' }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="定制求职信"
        open={Boolean(coverLetter)}
        onCancel={() => setCoverLetter(null)}
        width={700}
        footer={
          <Button type="primary" onClick={() => setCoverLetter(null)}>
            关闭
          </Button>
        }
      >
        <div className="markdown-body">
          <ReactMarkdown>{coverLetter ?? ''}</ReactMarkdown>
        </div>
      </Modal>

      <Modal
        title={`AI 面试题（${app.positionTitle}）`}
        open={Boolean(questions)}
        onCancel={() => setQuestions(null)}
        width={760}
        footer={
          <Button type="primary" onClick={() => setQuestions(null)}>
            关闭
          </Button>
        }
      >
        <Collapse
          size="small"
          items={(questions ?? []).map((q, i) => ({
            key: String(i),
            label: (
              <Space>
                <Tag color={q.difficulty === '困难' ? 'red' : q.difficulty === '中等' ? 'orange' : 'green'}>{q.difficulty}</Tag>
                <Tag>{q.category}</Tag>
                <span>
                  {i + 1}. {q.question}
                </span>
              </Space>
            ),
            children: (
              <Space direction="vertical" size={6}>
                <Typography.Text strong>回答要点：</Typography.Text>
                <Typography.Text>{q.tips}</Typography.Text>
                <Typography.Text strong>参考答案：</Typography.Text>
                <Typography.Text>{q.sample}</Typography.Text>
              </Space>
            ),
          }))}
        />
      </Modal>
    </Space>
  );
}
