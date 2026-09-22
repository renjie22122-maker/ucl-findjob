import { Alert, Badge, Button, Card, Space, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToday } from '../hooks';
import { remindersApi } from '../api';
import type { Reminder } from '../types';
import { REMINDER_TYPE_LABELS, formatDateTime } from '../utils/constants';

function ReminderCard({
  reminder,
  onDone,
  disabled,
  loading,
}: {
  reminder: Reminder;
  onDone: (r: Reminder) => void;
  disabled: boolean;
  loading: boolean;
}) {
  const navigate = useNavigate();
  return (
    <Card size="small">
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <Tag color={reminder.type === 'deadline' ? 'red' : reminder.type === 'interview' ? 'purple' : 'geekblue'}>
              {REMINDER_TYPE_LABELS[reminder.type]}
            </Tag>
            <Typography.Text strong>{reminder.title}</Typography.Text>
          </Space>
          <Button
            size="small"
            type="text"
            icon={<CheckCircleOutlined />}
            loading={loading}
            disabled={disabled}
            onClick={() => onDone(reminder)}
          >
            标记完成
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {reminder.companyName} · {reminder.positionTitle} · {formatDateTime(reminder.scheduledAt)}
        </Typography.Text>
        <Button
          size="small"
          type="link"
          style={{ padding: 0 }}
          onClick={() => navigate(`/applications/${reminder.applicationId}`)}
        >
          查看投递详情 →
        </Button>
      </Space>
    </Card>
  );
}

export default function Today() {
  const { data, error, isError, isFetching, isLoading, refetch } = useToday();
  const queryClient = useQueryClient();

  const doneMutation = useMutation({
    mutationFn: (r: Reminder) => remindersApi.setDone(r.id, true),
    onSuccess: () => {
      message.success('提醒已标记为完成');
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '标记失败，请稍后重试'),
  });

  const todayItems = data?.today ?? [];
  const total = todayItems.length;

  if (isLoading) {
    return <Card loading><span role="status">正在加载今日待办…</span></Card>;
  }

  if (isError) {
    return (
      <Alert
        showIcon
        type="error"
        message="无法加载今日待办"
        description={error instanceof Error ? error.message : '请求失败，请稍后重试。'}
        action={<Button loading={isFetching} onClick={() => void refetch()}>重新加载</Button>}
      />
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={5}>
          {data?.date} 今日待办 {total > 0 ? `（剩余 ${total} 项）` : ''}
        </Typography.Title>
      </Card>

      {data && data.overdue.length > 0 && (
        <Card title={<Badge status="error" text={`已过期未完成（${data.overdue.length}）`} />} size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            {data.overdue.map((r) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                disabled={doneMutation.isPending}
                loading={doneMutation.isPending && doneMutation.variables?.id === r.id}
                onDone={(x) => doneMutation.mutate(x)}
              />
            ))}
          </Space>
        </Card>
      )}

      <Card title="今天" size="small">
        {total === 0 ? (
          <Typography.Text type="secondary">今天没有待办，继续保持！</Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {todayItems.map((r) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                disabled={doneMutation.isPending}
                loading={doneMutation.isPending && doneMutation.variables?.id === r.id}
                onDone={(x) => doneMutation.mutate(x)}
              />
            ))}
          </Space>
        )}
      </Card>

      <Card title="未来 3 天" size="small">
        {(data?.upcoming ?? []).length === 0 ? (
          <Typography.Text type="secondary">未来 3 天暂无提醒</Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {data!.upcoming.map((r) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                disabled={doneMutation.isPending}
                loading={doneMutation.isPending && doneMutation.variables?.id === r.id}
                onDone={(x) => doneMutation.mutate(x)}
              />
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
}
