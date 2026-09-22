import { Timeline, Tag, Empty } from 'antd';
import { SwapOutlined, EditOutlined } from '@ant-design/icons';
import type { TimelineEvent } from '../types';
import { STATUS_LABELS } from '../utils/constants';
import { formatDateTime } from '../utils/constants';

export default function AppTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <Empty description="暂无记录" />;

  return (
    <Timeline
      items={events.map((e) => ({
        color: e.eventType === 'status_change' ? 'blue' : 'gray',
        dot: e.eventType === 'status_change' ? <SwapOutlined /> : <EditOutlined />,
        children: (
          <div>
            <div style={{ fontWeight: 500 }}>{e.title}</div>
            {e.eventType === 'status_change' && e.fromStatus && e.toStatus && (
              <div>
                <Tag>{STATUS_LABELS[e.fromStatus]}</Tag>→<Tag color="blue">{STATUS_LABELS[e.toStatus]}</Tag>
              </div>
            )}
            {e.description && <div style={{ color: '#888', fontSize: 12 }}>{e.description}</div>}
            <div style={{ color: '#aaa', fontSize: 12 }}>{formatDateTime(e.occurredAt)}</div>
          </div>
        ),
      }))}
    />
  );
}
