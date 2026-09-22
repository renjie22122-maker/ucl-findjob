import { Badge, Button, Card, Popconfirm, Select, Space, Table, Typography, message } from 'antd';
import { AuditOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '../api';
import type { AuditKind } from '../types';
import { formatDateTime } from '../utils/constants';

const KIND_META: Record<AuditKind, { label: string; color: string }> = {
  crawl: { label: '爬虫抓取', color: 'blue' },
  imap: { label: '邮件拉取', color: 'cyan' },
  llm: { label: 'AI 分析', color: 'purple' },
  oauth2: { label: '微软授权', color: 'geekblue' },
  'jd-parse': { label: '链接解析', color: 'gold' },
  github: { label: 'GitHub 导入', color: 'magenta' },
  ai: { label: 'AI 简历能力', color: 'purple' },
  publish: { label: '快照发布', color: 'green' },
  autofill: { label: '自动填表', color: 'volcano' },
};

export default function AuditPanel() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', kind, page],
    queryFn: () => auditApi.list({ kind, page, pageSize: 20 }),
  });

  const clearMutation = useMutation({
    mutationFn: () => auditApi.clear(),
    onSuccess: () => {
      message.success('审计日志已清空');
      queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  return (
    <Card
      title={
        <Space>
          <AuditOutlined /> 出站调用审计
        </Space>
      }
      size="small"
      extra={
        <Space>
          <Select
            allowClear
            placeholder="全部类型"
            style={{ width: 140 }}
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPage(1);
            }}
            options={Object.entries(KIND_META).map(([value, m]) => ({ value, label: m.label }))}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['audit'] })}
          >
            刷新
          </Button>
          <Popconfirm title="清空全部审计日志？" onConfirm={() => clearMutation.mutate()}>
            <Button size="small" danger icon={<DeleteOutlined />} loading={clearMutation.isPending}>
              清空
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        记录每一次爬虫/邮件/AI/微软授权的出站调用：时间、目标地址、发送内容摘要（凭据永不记录）、结果与耗时。仅存本地，最多保留 2000 条。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: '暂无出站调用记录（使用爬虫/邮件分析后会自动出现）' }}
        pagination={{
          current: data?.page ?? 1,
          pageSize: data?.pageSize ?? 20,
          total: data?.total ?? 0,
          showTotal: (t) => `共 ${t} 条`,
          onChange: setPage,
        }}
        columns={[
          { title: '时间', dataIndex: 'startedAt', width: 150, render: (v) => formatDateTime(v) },
          {
            title: '类型',
            dataIndex: 'kind',
            width: 100,
            render: (k: AuditKind) => <Badge color={KIND_META[k].color} text={KIND_META[k].label} />,
          },
          { title: '目标', dataIndex: 'target', ellipsis: true, render: (v) => <Typography.Text code>{v}</Typography.Text> },
          { title: '发送内容', dataIndex: 'detail', ellipsis: true },
          {
            title: '结果',
            dataIndex: 'status',
            width: 220,
            render: (s: string, row) =>
              s === 'success' ? (
                <Typography.Text type="success">{row.result}</Typography.Text>
              ) : (
                <Typography.Text type="danger">{row.error ?? '失败'}</Typography.Text>
              ),
          },
          { title: '耗时', dataIndex: 'durationMs', width: 80, render: (v) => (v === null ? '-' : `${v}ms`) },
        ]}
      />
    </Card>
  );
}
