import { Badge, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { ClockCircleOutlined, PlusOutlined, PlayCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crawlJobsApi } from '../api';
import type { CrawlJob, CrawlRun } from '../types';
import { formatDateTime } from '../utils/constants';

const FREQUENCY_LABELS = { daily: '每日', weekly: '每周' } as const;
const RUN_STATUS: Record<CrawlRun['status'], { color: string; label: string }> = {
  running: { color: 'processing', label: '执行中' },
  success: { color: 'success', label: '成功' },
  failed: { color: 'error', label: '失败' },
};

export default function CrawlJobsPanel() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CrawlJob | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['crawl-jobs'], queryFn: crawlJobsApi.list });
  const { data: runsData } = useQuery({
    queryKey: ['crawl-runs'],
    queryFn: () => crawlJobsApi.runs({ page: 1, pageSize: 10 }),
    enabled: showRuns,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['crawl-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['crawl-runs'] });
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['companies'] });
  };

  const saveMutation = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      editing ? crawlJobsApi.update(editing.id, v) : crawlJobsApi.create({ ...v, sourceId: 'nowcoder' }),
    onSuccess: () => {
      message.success(editing ? '任务已更新' : '任务已创建');
      setModalOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
  });

  const toggleMutation = useMutation({
    mutationFn: (job: CrawlJob) => crawlJobsApi.update(job.id, { enabled: (job.enabled ? 0 : 1) as 0 | 1 }),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => crawlJobsApi.remove(id),
    onSuccess: () => {
      message.success('任务已删除');
      invalidate();
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (id: number) => crawlJobsApi.runNow(id),
    onSuccess: () => {
      message.success('已触发执行，结果稍后出现在运行历史中');
      setShowRuns(true);
      setTimeout(() => invalidate(), 2000);
    },
  });

  const jobs = data?.items ?? [];

  return (
    <>
      <Card
        title={
          <Space>
            <ClockCircleOutlined /> 定时自动抓取
          </Space>
        }
        size="small"
        extra={
          <Space>
            <Button size="small" onClick={() => setShowRuns((s) => !s)}>
              {showRuns ? '隐藏运行历史' : '运行历史'}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                form.resetFields();
                setModalOpen(true);
              }}
            >
              新建任务
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          应用运行期间每分钟检查一次：到期任务自动抓取牛客网职位并导入（重复自动去重）。上次运行失败会等到下一周期重试。
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={jobs}
          pagination={false}
          locale={{ emptyText: '暂无定时任务，点击「新建任务」添加' }}
          columns={[
            { title: '关键词', dataIndex: 'keyword', width: 120 },
            { title: '类型', dataIndex: 'recruitType', width: 70, render: (v) => (v === 'intern' ? '实习' : '校招') },
            { title: '页数', dataIndex: 'maxPages', width: 60 },
            { title: '频率', dataIndex: 'frequency', width: 70, render: (v) => FREQUENCY_LABELS[v as CrawlJob['frequency']] },
            {
              title: '启用',
              dataIndex: 'enabled',
              width: 70,
              render: (_, job) => (
                <Switch
                  size="small"
                  checked={Boolean(job.enabled)}
                  loading={toggleMutation.isPending}
                  onChange={() => toggleMutation.mutate(job)}
                />
              ),
            },
            { title: '上次运行', dataIndex: 'lastRunAt', width: 150, render: (v) => (v ? formatDateTime(v) : '从未') },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              render: (_, job) => (
                <Space size={4}>
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined />}
                    loading={runNowMutation.isPending}
                    onClick={() => runNowMutation.mutate(job.id)}
                  >
                    立即运行
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(job);
                      form.setFieldsValue(job);
                      setModalOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm title="删除该任务及其运行历史？" onConfirm={() => deleteMutation.mutate(job.id)}>
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />

        {showRuns && (
          <div style={{ marginTop: 12 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              最近运行历史
            </Typography.Text>
            <Table
              rowKey="id"
              size="small"
              dataSource={runsData?.items ?? []}
              pagination={false}
              locale={{ emptyText: '暂无运行记录' }}
              columns={[
                { title: '时间', dataIndex: 'startedAt', width: 150, render: (v) => formatDateTime(v) },
                { title: '关键词', dataIndex: 'keyword', width: 120 },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 90,
                  render: (s: CrawlRun['status']) => <Badge status={RUN_STATUS[s].color as never} text={RUN_STATUS[s].label} />,
                },
                { title: '抓取', dataIndex: 'fetched', width: 60 },
                { title: '导入', dataIndex: 'imported', width: 60, render: (v, r) => <Tag color="green">{v} 新</Tag> },
                { title: '去重跳过', dataIndex: 'skipped', width: 80, render: (v, r) => (r.status === 'success' ? `${v} 条` : '-') },
                { title: '错误', dataIndex: 'error', ellipsis: true, render: (v) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : '-') },
              ]}
            />
          </div>
        )}
      </Card>

      <Modal
        title={editing ? '编辑定时任务' : '新建定时任务'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        okText="保存"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ recruitType: 'school', maxPages: 3, frequency: 'daily' }}
          onFinish={(v) => saveMutation.mutate(v)}
        >
          <Form.Item name="keyword" label="关键词" rules={[{ required: true, message: '请输入关键词' }]}>
            <Input prefix={<ThunderboltOutlined />} placeholder="如：后端 / 前端 / 算法" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="recruitType" label="类型">
              <Select
                style={{ width: 110 }}
                options={[
                  { value: 'school', label: '校招' },
                  { value: 'intern', label: '实习' },
                ]}
              />
            </Form.Item>
            <Form.Item name="maxPages" label="页数">
              <InputNumber min={1} max={10} />
            </Form.Item>
            <Form.Item name="frequency" label="频率">
              <Select
                style={{ width: 110 }}
                options={[
                  { value: 'daily', label: '每日' },
                  { value: 'weekly', label: '每周' },
                ]}
              />
            </Form.Item>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            到点自动抓取并导入；同一公司+岗位的职位不会重复入库。
          </Typography.Text>
        </Form>
      </Modal>
    </>
  );
}
