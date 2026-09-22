import { Modal, Form, Input, message } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { companiesApi } from '../api';
import type { Company } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Company | null;
}

export default function CompanyFormModal({ open, onClose, editing }: Props) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      if (editing) form.setFieldsValue(editing);
      else form.resetFields();
    }
  }, [open, editing, form]);

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      editing ? companiesApi.update(editing.id, values) : companiesApi.create(values),
    onSuccess: () => {
      message.success(editing ? '已更新' : '已创建');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      onClose();
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
  });

  return (
    <Modal
      title={editing ? '编辑公司' : '新建公司'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      okText="保存"
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
        <Form.Item name="name" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
          <Input placeholder="如：字节跳动" />
        </Form.Item>
        <Form.Item name="industry" label="行业">
          <Input placeholder="如：互联网" />
        </Form.Item>
        <Form.Item name="city" label="城市">
          <Input placeholder="如：北京" />
        </Form.Item>
        <Form.Item name="website" label="官网">
          <Input placeholder="https://..." />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
