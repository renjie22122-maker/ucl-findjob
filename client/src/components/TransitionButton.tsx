import { Button, Dropdown, message } from 'antd';
import { DownOutlined, UndoOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { applicationsApi } from '../api';
import type { AppStatus } from '../types';
import { STATUS_LABELS, TERMINAL_STATUSES } from '../utils/constants';

/** 与后端 domain/status.ts 同步的流转规则（ADR-1 注释同步） */
const TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  WISHLIST: ['APPLIED', 'REJECTED', 'WITHDRAWN'],
  APPLIED: ['SCREENING', 'WRITTEN_TEST', 'INTERVIEW_1', 'INTERVIEW_2', 'INTERVIEW_3', 'HR_INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['WRITTEN_TEST', 'INTERVIEW_1', 'REJECTED', 'WITHDRAWN'],
  WRITTEN_TEST: ['INTERVIEW_1', 'INTERVIEW_2', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW_1: ['INTERVIEW_2', 'INTERVIEW_3', 'HR_INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW_2: ['INTERVIEW_3', 'HR_INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW_3: ['HR_INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  HR_INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['SIGNED', 'REJECTED', 'WITHDRAWN'],
  SIGNED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

interface Props {
  applicationId: number;
  status: AppStatus;
  size?: 'small' | 'middle';
}

export default function TransitionButton({ applicationId, status, size = 'small' }: Props) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: { toStatus: AppStatus; note?: string | null; reopen?: boolean }) =>
      applicationsApi.transition(applicationId, body),
    onSuccess: (_, vars) => {
      message.success(vars.reopen ? '已重新打开投递流程' : `已更新为「${STATUS_LABELS[vars.toStatus]}」`);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : '操作失败');
    },
    onSettled: () => setLoading(false),
  });

  const doTransition = (toStatus: AppStatus, reopen?: boolean) => {
    setLoading(true);
    mutation.mutate({ toStatus, reopen });
  };

  if (TERMINAL_STATUSES.includes(status)) {
    return (
      <Button size={size} icon={<UndoOutlined />} loading={loading} onClick={() => doTransition('APPLIED', true)}>
        重新打开
      </Button>
    );
  }

  const options = TRANSITIONS[status] ?? [];
  if (options.length === 0) return null;

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: options.map((s) => ({ key: s, label: STATUS_LABELS[s] })),
        onClick: ({ key }) => doTransition(key as AppStatus),
      }}
    >
      <Button size={size} loading={loading}>
        推进状态 <DownOutlined />
      </Button>
    </Dropdown>
  );
}
