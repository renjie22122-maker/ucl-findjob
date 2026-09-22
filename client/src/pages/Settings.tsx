import { Alert, Button, Card, Col, Form, Input, InputNumber, Radio, Row, Space, Switch, Typography, Upload, message } from 'antd';
import { CloudDownloadOutlined, CloudUploadOutlined, InboxOutlined, RobotOutlined, WindowsOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { oauth2Api, settingsApi, snapshotApi, sourcesApi } from '../api';
import ImportResultModal from '../components/ImportResultModal';
import DeviceCodeModal from '../components/DeviceCodeModal';
import AuditPanel from '../components/AuditPanel';
import type { ImportResult } from '../types';

export default function Settings() {
  const queryClient = useQueryClient();
  const [emailForm] = Form.useForm();
  const [llmForm] = Form.useForm();
  const [oauthForm] = Form.useForm();
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [authMode, setAuthMode] = useState<'password' | 'oauth2'>('password');
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [publishPath, setPublishPath] = useState('');
  const [publishing, setPublishing] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (!settings) return;

    setAuthMode(settings.email?.authMode ?? 'password');
    llmForm.setFieldsValue({
      baseUrl: settings.llm?.baseUrl ?? 'https://api.deepseek.com',
      apiKey: '',
      model: settings.llm?.model ?? 'deepseek-chat',
    });
  }, [llmForm, settings]);

  useEffect(() => {
    if (!settings) return;

    const email = settings.email;
    if (authMode === 'password') {
      const wasUsingOauth2 = email?.authMode === 'oauth2';
      emailForm.setFieldsValue({
        host: wasUsingOauth2 ? 'imap.qq.com' : email?.host ?? 'imap.qq.com',
        port: wasUsingOauth2 ? 993 : email?.port ?? 993,
        secure: wasUsingOauth2 ? true : email?.secure ?? true,
        user: wasUsingOauth2 ? '' : email?.user ?? '',
        password: '',
        folder: email?.folder ?? 'INBOX',
      });
    } else {
      oauthForm.setFieldsValue({
        tenant: email?.tenant ?? 'consumers',
        clientId: email?.clientId ?? '',
      });
    }
  }, [authMode, emailForm, oauthForm, settings]);

  const saveEmail = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      settingsApi.update({
        email: {
          authMode: 'password',
          host: v.host as string,
          port: Number(v.port),
          secure: Boolean(v.secure),
          user: v.user as string,
          password: (v.password as string) || undefined,
          folder: (v.folder as string) || 'INBOX',
        },
      }),
    onSuccess: () => {
      message.success('邮箱配置已保存');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
  });

  const saveLlm = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      settingsApi.update({
        llm: {
          baseUrl: (v.baseUrl as string) || 'https://api.deepseek.com',
          apiKey: (v.apiKey as string) || undefined,
          model: (v.model as string) || 'deepseek-chat',
        },
      }),
    onSuccess: () => {
      message.success('AI 配置已保存');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
  });

  const disconnectOauth2 = useMutation({
    mutationFn: () => oauth2Api.disconnect(),
    onSuccess: () => {
      message.success('已断开 Outlook 连接');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const r = await settingsApi.testEmail();
      r.ok ? message.success(r.message) : message.error(r.message);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    try {
      const r = await settingsApi.testLlm();
      r.ok ? message.success(r.message) : message.error(r.message);
    } finally {
      setTestingLlm(false);
    }
  };

  const handleImport = async (file: File) => {
    try {
      const result = await sourcesApi.importExcel(file);
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败');
    }
    return false;
  };

  const handlePublish = async () => {
    if (!publishPath.trim()) {
      message.warning('请填写本地 git 仓库路径');
      return;
    }
    setPublishing(true);
    try {
      const r = await snapshotApi.publish(publishPath.trim());
      r.ok ? message.success(r.output) : message.error(r.output);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <InboxOutlined /> 邮箱配置（IMAP）
              </Space>
            }
            size="small"
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="QQ 邮箱/163 等需开启 IMAP 并使用「授权码」；Gmail 使用「应用专用密码」；Outlook 需通过 OAuth2 授权（微软已停用密码登录）。授权码/Token 仅保存在本地 SQLite。"
            />
            <Radio.Group
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value)}
              style={{ marginBottom: 12 }}
              options={[
                { value: 'password', label: '授权码/应用密码（QQ/163/Gmail）' },
                { value: 'oauth2', label: 'Outlook OAuth2 授权' },
              ]}
            />

            {authMode === 'password' ? (
              <Form
                form={emailForm}
                layout="vertical"
                initialValues={{
                  host: 'imap.qq.com',
                  port: 993,
                  secure: true,
                  user: '',
                  folder: 'INBOX',
                }}
                onFinish={(v) => saveEmail.mutate(v)}
              >
                <Space.Compact block>
                  <Form.Item name="host" label="IMAP 服务器" rules={[{ required: true }]} style={{ flex: 1 }}>
                    <Input placeholder="imap.qq.com / imap.163.com / imap.gmail.com" />
                  </Form.Item>
                  <Form.Item name="port" label="端口" rules={[{ required: true }]}>
                    <InputNumber min={1} max={65535} style={{ width: 90 }} />
                  </Form.Item>
                  <Form.Item name="secure" label="SSL" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name="user" label="邮箱账号" rules={[{ required: true, message: '请输入邮箱账号' }]}>
                  <Input placeholder="you@qq.com" />
                </Form.Item>
                <Form.Item name="password" label={settings?.email?.passwordSet ? '授权码（已保存，留空保持不变）' : '授权码'}>
                  <Input.Password placeholder="邮箱授权码 / Gmail 应用专用密码" />
                </Form.Item>
                <Form.Item name="folder" label="邮件文件夹">
                  <Input placeholder="INBOX" />
                </Form.Item>
                <Space>
                  <Button type="primary" onClick={() => emailForm.submit()} loading={saveEmail.isPending}>
                    保存邮箱配置
                  </Button>
                  <Button onClick={handleTestEmail} loading={testingEmail}>
                    测试连接
                  </Button>
                </Space>
              </Form>
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {settings?.oauth2?.configured && (
                  <Alert
                    type="success"
                    showIcon
                    message={`已连接：${settings.oauth2.user}`}
                    action={
                      <Button size="small" danger loading={disconnectOauth2.isPending} onClick={() => disconnectOauth2.mutate()}>
                        断开
                      </Button>
                    }
                  />
                )}
                <Form form={oauthForm} layout="vertical" initialValues={{ tenant: 'consumers', clientId: '' }}>
                  <Form.Item name="tenant" label="账户类型">
                    <Radio.Group
                      options={[
                        { value: 'consumers', label: '个人 Microsoft 账户（推荐）' },
                        { value: 'organizations', label: '企业/学校账户' },
                        { value: 'common', label: '全部（common）' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="clientId" label="应用程序（客户端）ID" rules={[{ required: true, message: '请填写 Azure 应用 Client ID' }]}>
                    <Input placeholder="Azure 应用注册后获取的 Client ID" />
                  </Form.Item>
                </Form>
                <Space>
                  <Button
                    type="primary"
                    icon={<WindowsOutlined />}
                    onClick={async () => {
                      const v = await oauthForm.validateFields();
                      setDeviceModalOpen(true);
                    }}
                  >
                    {settings?.oauth2?.configured ? '重新连接 Outlook' : '连接 Outlook'}
                  </Button>
                  {settings?.oauth2?.configured && (
                    <Button onClick={handleTestEmail} loading={testingEmail}>
                      测试连接
                    </Button>
                  )}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Azure 注册指引：portal.azure.com → Microsoft Entra ID → 应用注册 → 新注册；账户类型按需选择；重定向 URI 平台选「移动和桌面应用程序」，填
                  https://login.microsoftonline.com/common/oauth2/nativeclient；「身份验证」→ 高级设置 → 允许公共客户端流 = 是；复制「应用程序(客户端) ID」填到上方。
                </Typography.Text>
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <RobotOutlined /> AI 配置（DeepSeek / OpenAI 兼容）
              </Space>
            }
            size="small"
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="默认使用 DeepSeek（deepseek-chat）。邮件内容仅在主动点击「分析邮件」时发送给所配置的服务；不配置 Key 时自动降级本地规则提取。"
            />
            <Form
              form={llmForm}
              layout="vertical"
              initialValues={{
                baseUrl: 'https://api.deepseek.com',
                model: 'deepseek-chat',
              }}
              onFinish={(v) => saveLlm.mutate(v)}
            >
              <Form.Item name="baseUrl" label="API 地址" rules={[{ required: true }]}>
                <Input placeholder="https://api.deepseek.com" />
              </Form.Item>
              <Form.Item name="apiKey" label={settings?.llm?.apiKeySet ? 'API Key（已保存，留空保持不变）' : 'API Key'}>
                <Input.Password placeholder="sk-..." />
              </Form.Item>
              <Form.Item name="model" label="模型" rules={[{ required: true }]}>
                <Input placeholder="deepseek-chat" />
              </Form.Item>
              <Space>
                <Button type="primary" onClick={() => llmForm.submit()} loading={saveLlm.isPending}>
                  保存 AI 配置
                </Button>
                <Button onClick={handleTestLlm} loading={testingLlm}>
                  测试连通
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card title="数据导入 / 导出" size="small">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Upload accept=".xlsx" showUploadList={false} beforeUpload={handleImport}>
              <Button icon={<CloudUploadOutlined />}>导入 Excel</Button>
            </Upload>
            <Button icon={<CloudDownloadOutlined />} onClick={() => sourcesApi.downloadTemplate()}>
              下载导入模板
            </Button>
            <Button icon={<CloudDownloadOutlined />} onClick={() => sourcesApi.exportExcel()}>
              导出全部数据
            </Button>
            <Button icon={<CloudDownloadOutlined />} onClick={() => snapshotApi.exportJson()}>
              导出快照 JSON
            </Button>
            <Button icon={<CloudDownloadOutlined />} onClick={() => snapshotApi.exportHtml()}>
              导出快照 HTML（只读公开视图）
            </Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            模板列：公司名称*、岗位名称*、岗位类型、投递渠道、JD链接、投递日期、截止日期、当前状态、优先级、备注（* 必填）。导出与模板列一致，可无损往返。数据备份 = 复制 server/data/findjob.db 文件。
          </Typography.Text>
          <Card size="small" title="发布到 GitHub Pages（公开只读视图）">
            <Space wrap>
              <Input
                placeholder="本地 git 仓库路径，如 D:\my-pages（需已配置好 origin/main）"
                style={{ width: 420 }}
                value={publishPath}
                onChange={(e) => setPublishPath(e.target.value)}
              />
              <Button
                icon={<CloudDownloadOutlined />}
                loading={publishing}
                onClick={handlePublish}
              >
                导出并推送快照
              </Button>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
              借鉴 autumn-recruitment-tracker 方案：自动写入 snapshot.html/json 到指定仓库并 git commit + push，GitHub Pages 展示只读进度页（不含任何凭据）。
            </Typography.Text>
          </Card>
        </Space>
      </Card>

      <AuditPanel />

      <DeviceCodeModal
        open={deviceModalOpen}
        tenant={(oauthForm.getFieldValue('tenant') as string) ?? 'consumers'}
        clientId={(oauthForm.getFieldValue('clientId') as string) ?? ''}
        onClose={() => setDeviceModalOpen(false)}
        onConnected={() => {
          queryClient.invalidateQueries({ queryKey: ['settings'] });
        }}
      />

      <ImportResultModal result={importResult} onClose={() => setImportResult(null)} title="Excel 导入结果" />
    </Space>
  );
}
