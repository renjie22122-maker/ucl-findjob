import { Modal, Form, Input, Select, DatePicker, Button, Checkbox, message, Space, Typography } from 'antd';
import { LinkOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applicationsApi, companiesApi, remindersApi, utilsApi } from '../api';
import type { Application } from '../types';
import { ALL_STATUSES, CHANNEL_OPTIONS, STATUS_LABELS } from '../utils/constants';
import dayjs from 'dayjs';
import CompanyFormModal from './CompanyFormModal';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Application | null;
}

export default function ApplicationFormModal({ open, onClose, editing }: Props) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [parsing, setParsing] = useState(false);

  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  });
  const companies = companiesData?.items ?? [];

  useEffect(() => {
    if (open) {
      if (editing) {
        form.setFieldsValue({
          companyId: editing.companyId,
          positionTitle: editing.positionTitle,
          jobType: editing.jobType,
          channel: editing.channel ?? undefined,
          jdUrl: editing.jdUrl ?? undefined,
          jdDescription: editing.jdDescription ?? undefined,
          priority: editing.priority,
          deadline: editing.deadline ? dayjs(editing.deadline) : undefined,
          appliedAt: editing.appliedAt ? dayjs(editing.appliedAt) : undefined,
          note: editing.note ?? undefined,
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, editing, form]);

  const mutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const { createDeadlineReminder, ...applicationValues } = values;
      const payload = {
        ...applicationValues,
        deadline: values.deadline ? (values.deadline as dayjs.Dayjs).format('YYYY-MM-DDTHH:mm:ss') : null,
        appliedAt: values.appliedAt ? (values.appliedAt as dayjs.Dayjs).format('YYYY-MM-DD') : null,
      };
      const application = editing
        ? await applicationsApi.update(editing.id, payload)
        : await applicationsApi.create({ ...payload, status: 'WISHLIST' });

      let reminderWarning = false;
      if (!editing && createDeadlineReminder && payload.deadline) {
        try {
          await remindersApi.create({
            applicationId: application.id,
            type: 'deadline',
            title: `投递截止：${application.companyName ?? ''} ${application.positionTitle}`.trim(),
            scheduledAt: payload.deadline,
          });
        } catch {
          reminderWarning = true;
        }
      }
      return { application, reminderWarning };
    },
    onSuccess: ({ reminderWarning }) => {
      if (reminderWarning) {
        message.warning('岗位已创建，但截止提醒创建失败；可在投递详情中手动添加提醒');
      } else {
        message.success(editing ? '已更新' : '已创建');
      }
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      onClose();
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
  });

  const handleParseJd = async () => {
    const url = form.getFieldValue('jdUrl');
    if (!url) {
      message.warning('请先填写 JD 链接');
      return;
    }
    setParsing(true);
    try {
      const result = await utilsApi.parseJd(url);
      form.setFieldsValue({
        ...(result.title ? { positionTitle: result.title } : {}),
        ...(result.description ? { jdDescription: result.description } : {}),
      });
      if (result.companyHint) {
        const matched = companies.find((c) => c.name.includes(result.companyHint!) || result.companyHint!.includes(c.name));
        if (matched) {
          form.setFieldsValue({ companyId: matched.id });
          message.success(`已解析标题，并匹配到公司「${matched.name}」`);
        } else {
          message.success('已解析标题（未能自动匹配公司，请手动选择）');
        }
      } else if (result.title) {
        message.success('已解析标题');
      } else {
        message.info('未能解析出内容（可能是 JS 渲染页面），请手动填写');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '解析失败');
    } finally {
      setParsing(false);
    }
  };

  return (
    <>
      <Modal
        title={editing ? '编辑投递' : '新建投递'}
        open={open}
        onCancel={onClose}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        okText="保存"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => mutation.mutate(v)}
          initialValues={{ jobType: 'school', priority: 'MEDIUM', createDeadlineReminder: true }}
        >
          <Form.Item name="companyId" label="公司" rules={[{ required: true, message: '请选择公司' }]}>
            <Select
              showSearch
              placeholder="选择或搜索公司"
              optionFilterProp="label"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Button type="link" icon={<PlusOutlined />} onClick={() => setCompanyModalOpen(true)}>
                    新建公司
                  </Button>
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="positionTitle" label="岗位名称" rules={[{ required: true, message: '请输入岗位名称' }]}>
            <Input placeholder="如：后端开发工程师" />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="jdUrl" label="JD 链接" style={{ width: '100%' }}>
              <Input placeholder="粘贴官网/招聘链接（可选）" />
            </Form.Item>
            <Form.Item label=" " style={{ width: 'auto' }}>
              <Button icon={<LinkOutlined />} loading={parsing} onClick={handleParseJd}>
                解析预填
              </Button>
            </Form.Item>
          </Space.Compact>
          <Form.Item
            name="jdDescription"
            label="JD 描述"
            extra="解析预填后可继续修改；保存完整 JD 可提升简历匹配、求职信和面试题质量。"
          >
            <Input.TextArea rows={4} maxLength={4000} showCount placeholder="粘贴或解析岗位职责、任职要求（可选）" />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="jobType" label="类型">
              <Select
                style={{ width: 120 }}
                options={[
                  { value: 'school', label: '校招' },
                  { value: 'intern', label: '实习' },
                ]}
              />
            </Form.Item>
            <Form.Item name="channel" label="渠道">
              <Select style={{ width: 140 }} allowClear placeholder="选择渠道" options={CHANNEL_OPTIONS.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'HIGH', label: '高' },
                  { value: 'MEDIUM', label: '中' },
                  { value: 'LOW', label: '低' },
                ]}
              />
            </Form.Item>
          </Space>
          <Space size="large" wrap>
            <Form.Item name="appliedAt" label="投递日期">
              <DatePicker />
            </Form.Item>
            <Form.Item name="deadline" label="截止日期">
              <DatePicker showTime />
            </Form.Item>
          </Space>
          {!editing && (
            <Form.Item name="createDeadlineReminder" valuePropName="checked">
              <Checkbox>填写截止日期时，同时创建站内提醒</Checkbox>
            </Form.Item>
          )}
          {editing && (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              状态请通过「推进状态」按钮变更（当前：{STATUS_LABELS[editing.status]}）；新建记录初始状态为「待投递」，状态枚举共{' '}
              {ALL_STATUSES.length} 种。
            </Typography.Text>
          )}
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
      <CompanyFormModal open={companyModalOpen} onClose={() => setCompanyModalOpen(false)} />
    </>
  );
}
