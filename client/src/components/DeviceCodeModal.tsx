import { Alert, Button, Modal, Space, Spin, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { oauth2Api } from '../api';
import type { DeviceCodeStart } from '../types';

interface Props {
  open: boolean;
  tenant: string;
  clientId: string;
  onClose: () => void;
  onConnected: (email: string) => void;
}

/** Outlook OAuth2 设备码授权流程弹窗 */
export default function DeviceCodeModal({ open, tenant, clientId, onClose, onConnected }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'start' | 'waiting' | 'done' | 'error'>('start');
  const [device, setDevice] = useState<DeviceCodeStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopPolling();
      setStep('start');
      setDevice(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => () => stopPolling(), []);

  const handleStart = async () => {
    setError(null);
    try {
      const d = await oauth2Api.start(tenant, clientId);
      setDevice(d);
      setStep('waiting');
      const delay = (d.interval ?? 5) * 1000;
      pollTimer.current = setInterval(() => void doPoll(d), delay);
      void doPoll(d); // 立即先轮询一次
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
      setStep('error');
    }
  };

  const doPoll = async (d: DeviceCodeStart) => {
    try {
      const result = await oauth2Api.poll(tenant, clientId, d.deviceCode);
      if (result.status === 'complete') {
        stopPolling();
        setStep('done');
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        onConnected(result.email ?? 'outlook-user');
      } else if (result.status === 'expired' || result.status === 'error') {
        stopPolling();
        setStep('error');
        setError(result.message ?? '授权失败');
      } else if (result.status === 'slow_down') {
        setDevice({ ...d, interval: (d.interval ?? 5) + 5 });
      }
    } catch (err) {
      // 网络抖动时不中断流程，等下一轮
      if (!(err instanceof Error && err.message.includes('重新连接'))) return;
      stopPolling();
      setStep('error');
      setError(err instanceof Error ? err.message : '轮询失败');
    }
  };

  return (
    <Modal
      title="连接 Outlook（Microsoft 账户授权）"
      open={open}
      onCancel={() => {
        stopPolling();
        onClose();
      }}
      footer={
        step === 'start' ? (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleStart}>
              生成验证码
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{step === 'done' ? '完成' : '关闭'}</Button>
        )
      }
    >
      {step === 'start' && (
        <Typography.Paragraph type="secondary">
          点击「生成验证码」后，将在新窗口打开微软登录页，使用你的 Outlook 账户完成授权（个人账户选「consumers」）。授权仅用于读取邮件（IMAP）。
        </Typography.Paragraph>
      )}

      {step === 'waiting' && device && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph>
            1. 打开 <a href={device.verificationUri} target="_blank" rel="noreferrer">{device.verificationUri}</a>；
            2. 输入验证码并完成登录授权：
          </Typography.Paragraph>
          <Typography.Title level={2} copyable style={{ textAlign: 'center', letterSpacing: 4 }}>
            {device.userCode}
          </Typography.Title>
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">等待授权中（约 {device.expiresIn}s 内有效）…</Typography.Text>
          </Space>
        </Space>
      )}

      {step === 'done' && (
        <Alert type="success" showIcon message="授权成功！Outlook 邮箱已连接，可前往「邮件分析」页使用。" />
      )}

      {step === 'error' && (
        <Alert
          type="error"
          showIcon
          message="连接失败"
          description={error}
          action={
            <Button size="small" onClick={() => setStep('start')}>
              重试
            </Button>
          }
        />
      )}
    </Modal>
  );
}
