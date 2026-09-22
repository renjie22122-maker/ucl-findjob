import { Button, Card, Input, Popconfirm, Space, Table, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { companiesApi } from '../api';
import CompanyFormModal from '../components/CompanyFormModal';
import type { Company } from '../types';
import { formatDateTime } from '../utils/constants';

export default function Companies() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['companies', keyword],
    queryFn: () => companiesApi.list(keyword),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => companiesApi.remove(id),
    onSuccess: () => {
      message.success('已删除（关联投递一并删除）');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '删除失败'),
  });

  return (
    <Card
      title="公司管理"
      extra={
        <Space>
          <Input.Search placeholder="搜索公司" allowClear style={{ width: 220 }} onSearch={setKeyword} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            新建公司
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={false}
        columns={[
          { title: '公司', dataIndex: 'name', width: 220 },
          { title: '行业', dataIndex: 'industry', width: 120, render: (v) => v || '-' },
          { title: '城市', dataIndex: 'city', width: 100, render: (v) => v || '-' },
          {
            title: '官网',
            dataIndex: 'website',
            ellipsis: true,
            render: (v) => (v ? <a href={v.startsWith('http') ? v : `https://${v}`} target="_blank" rel="noreferrer">{v}</a> : '-'),
          },
          { title: '投递数', dataIndex: 'applicationCount', width: 90 },
          { title: '更新时间', dataIndex: 'updatedAt', width: 150, render: (v) => formatDateTime(v) },
          {
            title: '操作',
            key: 'actions',
            width: 150,
            render: (_, row) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(row);
                    setModalOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Popconfirm title={`删除「${row.name}」及其全部投递记录？`} onConfirm={() => deleteMutation.mutate(row.id)}>
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <CompanyFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      />
    </Card>
  );
}
