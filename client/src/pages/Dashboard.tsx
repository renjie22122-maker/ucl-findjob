import { Alert, Button, Card, Col, Input, List, Row, Select, Table, Typography, Space, Tag, message } from 'antd';
import {
  FileTextOutlined,
  SearchOutlined,
  SyncOutlined,
  TrophyOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOverview, useTrends } from '../hooks';
import StatCard from '../components/StatCard';
import { FunnelChart, StatusPieChart, TrendChart } from '../components/charts';
import StatusTag from '../components/StatusTag';
import { aiApi, applicationsApi, resumesApi, sourcesApi } from '../api';
import { formatDate, formatDateTime, PRIORITY_LABELS, PRIORITY_COLORS } from '../utils/constants';
import { ALL_STATUSES } from '../utils/constants';
import { useFiltersStore } from '../stores/filters';
import type { ActionListItem, Priority } from '../types';

export default function Dashboard() {
  const navigate = useNavigate();
  const applicationFilters = useFiltersStore();
  const { data: stats, isLoading } = useOverview();
  const { data: trendsData } = useTrends(30);

  const { data: recent } = useQuery({
    queryKey: ['applications', 'recent'],
    queryFn: () => applicationsApi.list({ page: 1, pageSize: 10, sortBy: 'updatedAt', sortOrder: 'desc' }),
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="📋 投递板块入口"
        description={
          <span>
            全部投递记录在「投递管理」页：点击顶部导航或下方「总投递」卡片进入；新建投递点右上角「新建投递」按钮。
            <Button type="link" size="small" onClick={() => navigate('/applications')}>
              立即进入投递管理 →
            </Button>
          </span>
        }
      />
      <QuickCrawlCard />
      <Row gutter={16}>
        <Col xs={12} md={6}>
          <StatCard
            title="总投递"
            value={stats?.total ?? 0}
            icon={<FileTextOutlined />}
            loading={isLoading}
            onClick={() => {
              applicationFilters.reset();
              navigate('/applications');
            }}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            title="进行中"
            value={stats?.active ?? 0}
            icon={<SyncOutlined />}
            color="#1677ff"
            loading={isLoading}
            onClick={() => {
              applicationFilters.reset();
              applicationFilters.set({
                statuses: ALL_STATUSES.filter((status) => !['SIGNED', 'REJECTED', 'WITHDRAWN'].includes(status)),
              });
              navigate('/applications');
            }}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            title="Offer/签约"
            value={stats?.offers ?? 0}
            icon={<TrophyOutlined />}
            color="#faad14"
            loading={isLoading}
            onClick={() => {
              applicationFilters.reset();
              applicationFilters.set({ statuses: ['OFFER', 'SIGNED'] });
              navigate('/applications');
            }}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="今日待办" value={(stats?.todayCount ?? 0) + (stats?.overdueCount ?? 0)} icon={<CalendarOutlined />} color="#ff4d4f" loading={isLoading} onClick={() => navigate('/today')} />
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="状态分布" size="small">
            <StatusPieChart stats={stats ?? { byStatus: {}, funnel: { applied: 0, interviewed: 0, offer: 0 } } as never} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="转化漏斗（投递 → 面试 → Offer）" size="small">
            <FunnelChart stats={stats ?? ({ funnel: { applied: 0, interviewed: 0, offer: 0 } } as never)} />
          </Card>
        </Col>
      </Row>

      <Card title="近 30 天趋势" size="small">
        <TrendChart trends={trendsData?.items ?? []} />
      </Card>

      <Card title="最近更新" size="small">
        <Table
          rowKey="id"
          size="small"
          loading={!recent}
          dataSource={recent?.items ?? []}
          pagination={false}
          onRow={(row) => ({ onClick: () => navigate(`/applications/${row.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '公司', dataIndex: 'companyName', width: 180 },
            { title: '岗位', dataIndex: 'positionTitle', ellipsis: true },
            { title: '状态', dataIndex: 'status', width: 110, render: (s) => <StatusTag status={s} /> },
            {
              title: '优先级',
              dataIndex: 'priority',
              width: 90,
              render: (p: Priority) => <Tag color={PRIORITY_COLORS[p]}>{PRIORITY_LABELS[p]}</Tag>,
            },
            { title: '更新时间', dataIndex: 'updatedAt', width: 150, render: (v) => formatDateTime(v) },
          ]}
        />
      </Card>
      <ActionListCard />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        近 7 天新投递 {stats?.recentApplied7d ?? 0} 条 · 被拒 {stats?.rejected ?? 0} 条
      </Typography.Text>
    </Space>
  );
}

/** 网上自动找岗位：看板快捷抓取（关键词 → 牛客网抓取并导入） */
function QuickCrawlCard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [recruitType, setRecruitType] = useState<'school' | 'intern'>('school');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const handleCrawl = async () => {
    if (!keyword.trim()) {
      message.warning('请输入关键词，如：后端 / 前端 / 算法');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const crawled = await sourcesApi.crawl({
        sourceId: 'nowcoder',
        params: { keyword: keyword.trim(), recruitType, maxPages: 1 },
      });
      if (crawled.records.length === 0) {
        message.info('未抓到职位，换个关键词试试');
        return;
      }
      const imported = await sourcesApi.importRecords(crawled.records);
      setResult({ imported: imported.imported, skipped: imported.skipped });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      message.success(`抓取 ${crawled.count} 条：新导入 ${imported.imported} 条，重复跳过 ${imported.skipped} 条`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '抓取失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="🔎 网上自动找岗位（牛客网）"
      size="small"
      extra={
        <Button size="small" type="link" onClick={() => navigate('/sources')}>
          高级：定时自动抓取 + 批量 AI 匹配 →
        </Button>
      }
    >
      <Space wrap>
        <Input
          placeholder="输入岗位关键词，如：后端"
          style={{ width: 220 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={handleCrawl}
        />
        <Select
          style={{ width: 100 }}
          value={recruitType}
          onChange={setRecruitType}
          options={[
            { value: 'school', label: '校招' },
            { value: 'intern', label: '实习' },
          ]}
        />
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={handleCrawl}>
          抓取并导入
        </Button>
        {result && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            上次：新导入 {result.imported} 条 · 去重跳过 {result.skipped} 条
          </Typography.Text>
        )}
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
        自动抓取牛客网职位（公司/薪资/城市/JD/截止日期）并去重入库，重复岗位自动跳过；「网上找岗位」页支持定时任务（每日/每周自动找）。
      </Typography.Paragraph>
    </Card>
  );
}

/** 今日投递清单：匹配度 × 紧急度（借鉴 Career-Search「AI 告诉你今天该投哪家」） */
function ActionListCard() {
  const navigate = useNavigate();
  const [resumeId, setResumeId] = useState<number | undefined>(undefined);
  const [items, setItems] = useState<ActionListItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: resumesData } = useQuery({ queryKey: ['resumes'], queryFn: resumesApi.list });
  const resumes = resumesData?.items ?? [];

  const handleLoad = async () => {
    if (!resumeId) return;
    setLoading(true);
    try {
      const r = await aiApi.actionList(resumeId, 10);
      setItems(r.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="🎯 今日投递清单（匹配度 × 截止紧急度）"
      size="small"
      extra={
        <Space>
          <Select
            size="small"
            placeholder="选简历"
            style={{ width: 160 }}
            value={resumeId}
            onChange={setResumeId}
            options={resumes.map((r) => ({ value: r.id, label: r.name }))}
          />
          <Button size="small" type="primary" loading={loading} disabled={!resumeId} onClick={handleLoad}>
            生成清单
          </Button>
        </Space>
      }
    >
      {items === null ? (
        <Typography.Text type="secondary">选择一份简历生成「今天该投哪家」清单</Typography.Text>
      ) : items.length === 0 ? (
        <Typography.Text type="secondary">没有可投递的待办岗位</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={items}
          renderItem={(m, i) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/applications/${m.applicationId}`)}
            >
              <Space>
                <Typography.Text strong>#{i + 1}</Typography.Text>
                <Tag color={m.actionScore >= 70 ? 'green' : m.actionScore >= 50 ? 'blue' : 'default'}>
                  综合 {m.actionScore}
                </Tag>
                <Typography.Text>
                  {m.companyName} · {m.positionTitle}
                </Typography.Text>
                {m.deadline && <Tag color={m.urgency >= 30 ? 'red' : m.urgency > 0 ? 'orange' : 'default'}>截止 {formatDate(m.deadline)}</Tag>}
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
