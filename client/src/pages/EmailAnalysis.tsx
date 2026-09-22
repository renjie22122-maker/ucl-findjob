import { Alert, Button, Card, Descriptions, Modal, Progress, Segmented, Space, Tag, Typography, message, Form, Input, DatePicker, Select } from 'antd';
import { CheckOutlined, CloseOutlined, MailOutlined, SettingOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailApi, settingsApi } from '../api';
import type { EmailExtraction, EmailItem } from '../types';
import { EMAIL_EVENT_COLORS, EMAIL_EVENT_LABELS, formatDateTime } from '../utils/constants';
import dayjs from 'dayjs';

export default function EmailAnalysis() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('pending');
  const [days, setDays] = useState(14);
  const [editItem, setEditItem] = useState<EmailItem | null>(null);
  const [editForm] = Form.useForm();

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  const { data, isLoading } = useQuery({
    queryKey: ['email', 'items', tab],
    queryFn: () => emailApi.items({ status: tab, page: 1, pageSize: 50 }),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => emailApi.analyze(days),
    onSuccess: (r) => {
      message.success(`分析完成：拉取 ${r.fetched} 封，候选 ${r.candidates} 封，新分析 ${r.analyzed} 封（去重跳过 ${r.skipped}）`);
      queryClient.invalidateQueries({ queryKey: ['email'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '分析失败'),
  });

  const applyMutation = useMutation({
    mutationFn: (item: EmailItem) => emailApi.apply(item.id, item.extracted ?? undefined),
    onSuccess: (r) => {
      if (r.warning) message.warning(r.warning);
      else message.success(r.timelineEvent ? '已生成时间线笔记与提醒' : '已应用');
      setEditItem(null);
      queryClient.invalidateQueries({ queryKey: ['email'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '应用失败'),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => emailApi.dismiss(id),
    onSuccess: () => {
      message.success('已忽略');
      queryClient.invalidateQueries({ queryKey: ['email'] });
    },
  });

  const batchApplyMutation = useMutation({
    mutationFn: () => emailApi.applyBatch(0.8),
    onSuccess: (r) => {
      message.success(
        r.applied > 0
          ? `批量应用完成：应用 ${r.applied} 条（时间线笔记+提醒已生成），跳过低置信度 ${r.skipped} 条`
          : `没有置信度 ≥ 0.8 的待处理邮件（跳过 ${r.skipped} 条低置信度）`,
      );
      queryClient.invalidateQueries({ queryKey: ['email'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '批量应用失败'),
  });

  const configured = Boolean(settings?.email);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {!configured && (
        <Alert
          type="warning"
          showIcon
          message="尚未配置邮箱"
          description="请先在设置页配置 IMAP 邮箱（QQ 邮箱/163 等需使用授权码）。未配置 LLM Key 时会自动降级本地规则提取。"
          action={
            <Button size="small" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
              去配置
            </Button>
          }
        />
      )}

      <Card
        size="small"
        title={
          <Space>
            <MailOutlined /> 邮件智能分析
          </Space>
        }
        extra={
          <Space>
            <Segmented options={[7, 14, 30]} value={days} onChange={(v) => setDays(v as number)} />
            <Button
              icon={<ThunderboltOutlined />}
              loading={batchApplyMutation.isPending}
              onClick={() => batchApplyMutation.mutate()}
            >
              批量应用高置信度（≥0.8）
            </Button>
            <Button type="primary" loading={analyzeMutation.isPending} disabled={!configured} onClick={() => analyzeMutation.mutate()}>
              分析最近 {days} 天邮件
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="分析流程：IMAP 拉取 → 关键词初筛招聘邮件 → DeepSeek 提取（公司/事件/时间/岗位）→ 人工确认后应用到时间线与提醒。AI 不直接修改状态机。"
        />
        <div style={{ marginTop: 12 }}>
          <Segmented
            options={[
              { value: 'pending', label: `待处理（${tab === 'pending' ? data?.total ?? 0 : '?'}）` },
              { value: 'confirmed', label: '已应用' },
              { value: 'dismissed', label: '已忽略' },
            ]}
            value={tab}
            onChange={(v) => setTab(v as string)}
          />
        </div>

        {analyzeMutation.isPending && <Progress percent={60} status="active" style={{ marginTop: 12 }} />}

        <Space direction="vertical" style={{ width: '100%', marginTop: 12 }}>
          {(data?.items ?? []).length === 0 && !isLoading && (
            <Typography.Text type="secondary">暂无{tab === 'pending' ? '待处理' : tab === 'confirmed' ? '已应用' : '已忽略'}邮件</Typography.Text>
          )}
          {(data?.items ?? []).map((item) => (
            <Card key={item.id} size="small" loading={isLoading}>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text strong>{item.subject}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.sender} · {formatDateTime(item.receivedAt)}
                  </Typography.Text>
                </Space>
                <Space wrap size={8}>
                  {item.extracted?.company && <Tag color="blue">公司：{item.extracted.company}</Tag>}
                  {item.extracted?.eventType && (
                    <Tag color={EMAIL_EVENT_COLORS[item.extracted.eventType]}>
                      事件：{EMAIL_EVENT_LABELS[item.extracted.eventType]}
                    </Tag>
                  )}
                  {item.extracted?.eventTime && <Tag color="orange">时间：{formatDateTime(item.extracted.eventTime)}</Tag>}
                  {item.extracted?.positionTitle && <Tag>岗位：{item.extracted.positionTitle}</Tag>}
                  <Tag color={item.extracted && item.extracted.confidence >= 0.7 ? 'green' : item.extracted && item.extracted.confidence >= 0.4 ? 'gold' : 'red'}>
                    置信度 {Math.round((item.extracted?.confidence ?? 0) * 100)}%
                  </Tag>
                  {item.applicationId && <Tag color="cyan">已关联申请 #{item.applicationId}</Tag>}
                </Space>
                {item.extracted?.summary && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.extracted.summary}
                  </Typography.Text>
                )}
                {item.snippet && (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }} ellipsis={{ rows: 1, expandable: true, symbol: '展开' }}>
                    正文：{item.snippet}
                  </Typography.Paragraph>
                )}
                {item.status === 'pending' && (
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={() => {
                        setEditItem(item);
                        editForm.setFieldsValue({
                          company: item.extracted?.company ?? undefined,
                          eventType: item.extracted?.eventType ?? undefined,
                          eventTime: item.extracted?.eventTime ? dayjs(item.extracted.eventTime) : undefined,
                          positionTitle: item.extracted?.positionTitle ?? undefined,
                          summary: item.extracted?.summary ?? undefined,
                          confidence: item.extracted?.confidence ?? 0,
                        });
                      }}
                    >
                      应用到追踪
                    </Button>
                    <Button size="small" icon={<CloseOutlined />} onClick={() => dismissMutation.mutate(item.id)}>
                      忽略
                    </Button>
                  </Space>
                )}
              </Space>
            </Card>
          ))}
        </Space>
      </Card>

      <Modal
        title="确认提取结果（可修改后应用）"
        open={Boolean(editItem)}
        onCancel={() => setEditItem(null)}
        onOk={() => {
          const v = editForm.getFieldsValue();
          const extracted: EmailExtraction = {
            company: v.company || null,
            eventType: v.eventType || null,
            eventTime: v.eventTime ? (v.eventTime as dayjs.Dayjs).format('YYYY-MM-DDTHH:mm:ss') : null,
            positionTitle: v.positionTitle || null,
            summary: v.summary || null,
            confidence: Number(v.confidence ?? 0),
          };
          if (editItem) applyMutation.mutate({ ...editItem, extracted });
        }}
        confirmLoading={applyMutation.isPending}
      >
        <Descriptions column={1} size="small" style={{ marginBottom: 8 }}>
          <Descriptions.Item label="邮件主题">{editItem?.subject}</Descriptions.Item>
        </Descriptions>
        <Form form={editForm} layout="vertical">
          <Form.Item name="company" label="公司">
            <Input placeholder="与库中公司模糊匹配，未匹配到仅记录邮件" />
          </Form.Item>
          <Form.Item name="eventType" label="事件类型">
            <Select allowClear options={Object.entries(EMAIL_EVENT_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="eventTime" label="事件时间（未来时间将自动创建提醒）">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="positionTitle" label="岗位">
            <Input />
          </Form.Item>
          <Form.Item name="summary" label="摘要">
            <Input />
          </Form.Item>
          <Form.Item name="confidence" label="置信度 (0-1)">
            <Input type="number" min={0} max={1} step={0.1} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
