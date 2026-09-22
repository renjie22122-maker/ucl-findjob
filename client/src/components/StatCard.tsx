import { Card, Statistic } from 'antd';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  value: number;
  icon?: ReactNode;
  color?: string;
  onClick?: () => void;
  loading?: boolean;
}

export default function StatCard({ title, value, icon, color, onClick, loading }: Props) {
  return (
    <Card
      hoverable={Boolean(onClick)}
      onClick={onClick}
      loading={loading}
      styles={{ body: { padding: 16 } }}
    >
      <Statistic
        title={
          <span>
            {icon} {title}
          </span>
        }
        value={value}
        valueStyle={color ? { color } : undefined}
      />
    </Card>
  );
}
