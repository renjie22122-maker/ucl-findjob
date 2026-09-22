import { Button, Card, Input, List, Modal, Progress, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined, ExportOutlined, RobotOutlined, SwapOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { aiApi, applicationsApi, companiesApi, resumesApi, sourcesApi } from '../api';
import { useFiltersStore } from '../stores/filters';
import StatusTag from '../components/StatusTag';
import TransitionButton from '../components/TransitionButton';
import ApplicationFormModal from '../components/ApplicationFormModal';
import ImportResultModal from '../components/ImportResultModal';
import { ALL_STATUSES, STATUS_LABELS, PRIORITY_LABELS, PRIORITY_COLORS, JOB_TYPE_LABELS, formatDate, formatDateTime } from '../utils/constants';
import type { Application, ImportResult, JobType, MatchAllItem, OfferCompareResult, Priority } from '../types';

type ScoreFilter = 'all' | 'high' | 'eduFail';

export default function Applications() {
  const navigate = useNavigate();
  const filters = useFiltersStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [matchResumeId, setMatchResumeId] = useState<number | undefined>(undefined);
  const [matchItems, setMatchItems] = useState<MatchAllItem[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [eduFilter, setEduFilter] = useState<string | undefined>(undefined);
  const [skillFilter, setSkillFilter] = useState<string[]>([]);
  const [offerCompareOpen, setOfferCompareOpen] = useState(false);
  const [offerSelected, setOfferSelected] = useState<number[]>([]);
  const [offerResult, setOfferResult] = useState<OfferCompareResult | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);

  const { data: offersData } = useQuery({
    queryKey: ['applications', 'offers'],
    queryFn: () => applicationsApi.list({ statuses: ['OFFER', 'SIGNED'], page: 1, pageSize: 100 }),
  });
  const offers = offersData?.items ?? [];

  const queryParams = {
    statuses: filters.statuses,
    companyId: filters.companyId,
    jobType: filters.jobType,
    priority: filters.priority,
    keyword: filters.keyword,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['applications', queryParams],
    queryFn: () => applicationsApi.list(queryParams),
  });

  const { data: companiesData } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const { data: resumesData } = useQuery({ queryKey: ['resumes'], queryFn: resumesApi.list });
  const companies = companiesData?.items ?? [];
  const resumes = resumesData?.items ?? [];

  const handleExport = async () => {
    setExporting(true);
    try {
      await sourcesApi.exportExcel({
        status: filters.statuses,
        companyId: filters.companyId,
        jobType: filters.jobType,
        priority: filters.priority,
        keyword: filters.keyword,
      });
    } finally {
      setExporting(false);
    }
  };

  const handleMatchAll = async () => {
    if (!matchResumeId) return;
    setMatching(true);
    try {
      const r = await aiApi.matchAll(matchResumeId);
      setMatchItems(r.items);
      setScoreFilter('all');
      setEduFilter(undefined);
      setSkillFilter([]);
      message.success(`全量匹配完成 ${r.items.length} 个岗位（学历/技能/城市结构化打分）`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '匹配失败');
    } finally {
      setMatching(false);
    }
  };

  const filteredMatchItems = useMemo(() => {
    if (!matchItems) return [];
    return matchItems.filter((m) => {
      if (scoreFilter === 'high' && m.score < 70) return false;
      if (scoreFilter === 'eduFail' && m.educationMatch !== false) return false;
      if (eduFilter && m.educationReq !== eduFilter) return false;
      if (skillFilter.length > 0 && !skillFilter.every((s) => m.skillHits.includes(s))) return false;
      return true;
    });
  }, [matchItems, scoreFilter, eduFilter, skillFilter]);

  const summary = useMemo(() => {
    if (!matchItems) return null;
    const high = matchItems.filter((m) => m.score >= 70).length;
    const eduFail = matchItems.filter((m) => m.educationMatch === false).length;
    return { total: matchItems.length, high, eduFail };
  }, [matchItems]);

  const matchedResume = resumes.find((r) => r.id === matchResumeId);
  const eduOptions = useMemo(() => {
    if (!matchItems) return [];
    return [...new Set(matchItems.map((m) => m.educationReq).filter(Boolean))] as NonNullable<MatchAllItem['educationReq']>[];
  }, [matchItems]);

  return (
    <Card>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Select
              placeholder="选简历开启匹配筛选"
              style={{ width: 190 }}
              value={matchResumeId}
              onChange={setMatchResumeId}
              options={resumes.map((r) => ({ value: r.id, label: r.name }))}
              notFoundContent={<Typography.Text type="secondary">去「简历管理」创建简历</Typography.Text>}
            />
            <Button icon={<RobotOutlined />} loading={matching} disabled={!matchResumeId} onClick={handleMatchAll}>
              全量匹配筛选
            </Button>
            {matchItems && (
              <Button
                size="small"
                onClick={() => {
                  setMatchItems(null);
                }}
              >
                退出匹配模式
              </Button>
            )}
            {!matchItems && (
              <>
                <Input.Search
                  placeholder="搜索公司/岗位"
                  allowClear
                  style={{ width: 200 }}
                  onSearch={(v) => filters.set({ keyword: v })}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="状态"
                  style={{ minWidth: 200 }}
                  maxTagCount={2}
                  value={filters.statuses}
                  onChange={(v) => filters.set({ statuses: v })}
                  options={ALL_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                />
                <Select
                  allowClear
                  showSearch
                  placeholder="公司"
                  style={{ width: 150 }}
                  value={filters.companyId}
                  onChange={(v) => filters.set({ companyId: v })}
                  optionFilterProp="label"
                  options={companies.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  allowClear
                  placeholder="类型"
                  style={{ width: 100 }}
                  value={filters.jobType}
                  onChange={(v) => filters.set({ jobType: v })}
                  options={[
                    { value: 'school', label: '校招' },
                    { value: 'intern', label: '实习' },
                  ]}
                />
                <Select
                  allowClear
                  placeholder="优先级"
                  style={{ width: 100 }}
                  value={filters.priority}
                  onChange={(v) => filters.set({ priority: v })}
                  options={[
                    { value: 'HIGH', label: '高' },
                    { value: 'MEDIUM', label: '中' },
                    { value: 'LOW', label: '低' },
                  ]}
                />
                <Select
                  aria-label="排序字段"
                  style={{ width: 130 }}
                  value={filters.sortBy}
                  onChange={(sortBy) => filters.set({ sortBy })}
                  options={[
                    { value: 'updatedAt', label: '按更新时间' },
                    { value: 'appliedAt', label: '按投递日期' },
                    { value: 'deadline', label: '按截止日期' },
                  ]}
                />
                <Select
                  aria-label="排序方向"
                  style={{ width: 100 }}
                  value={filters.sortOrder}
                  onChange={(sortOrder) => filters.set({ sortOrder })}
                  options={[
                    { value: 'desc', label: '降序' },
                    { value: 'asc', label: '升序' },
                  ]}
                />
                <Button icon={<ReloadOutlined />} onClick={() => filters.reset()}>
                  重置
                </Button>
              </>
            )}
          </Space>
          <Space>
            {offers.length >= 2 && (
              <Button icon={<SwapOutlined />} onClick={() => setOfferCompareOpen(true)}>
                Offer 对比（{offers.length}）
              </Button>
            )}
            <Button icon={<ExportOutlined />} loading={exporting} onClick={handleExport}>
              导出
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              新建投递
            </Button>
          </Space>
        </Space>

        {matchItems && (
          <Space wrap>
            {summary && (
              <Typography.Text>
                用「{matchedResume?.name}」匹配 <b>{summary.total}</b> 个岗位：高匹配（≥70）
                <Tag color="green">{summary.high}</Tag> 学历不符
                <Tag color="red">{summary.eduFail}</Tag>
              </Typography.Text>
            )}
            <Segmented
              size="small"
              value={scoreFilter}
              onChange={(v) => setScoreFilter(v as ScoreFilter)}
              options={[
                { value: 'all', label: '全部' },
                { value: 'high', label: '≥70 分' },
                { value: 'eduFail', label: '学历不符' },
              ]}
            />
            <Select
              size="small"
              allowClear
              placeholder="学历要求筛选"
              style={{ width: 130 }}
              value={eduFilter}
              onChange={setEduFilter}
              options={eduOptions.map((e) => ({ value: e, label: e }))}
            />
            <Select
              size="small"
              mode="multiple"
              allowClear
              placeholder="技能筛选（需全部命中）"
              style={{ width: 240 }}
              maxTagCount={2}
              value={skillFilter}
              onChange={setSkillFilter}
              options={(matchedResume?.skills ?? []).map((s) => ({ value: s, label: s }))}
            />
          </Space>
        )}

        {matchItems ? (
          <Table<MatchAllItem>
            rowKey={(row) => String(row.applicationId)}
            dataSource={filteredMatchItems}
            onRow={(row) => ({ onClick: () => navigate(`/applications/${row.applicationId}`), style: { cursor: 'pointer' } })}
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条（全量 ${matchItems.length}）` }}
            columns={[
              {
                title: '匹配度',
                key: 'score',
                width: 120,
                sorter: (a, b) => a.score - b.score,
                defaultSortOrder: 'descend',
                render: (_: unknown, m: MatchAllItem) => (
                  <Progress size="small" percent={m.score} format={(p) => `${p}分`} status={m.score >= 70 ? 'success' : m.score >= 50 ? 'normal' : 'exception'} />
                ),
              },
              { title: '公司', dataIndex: 'companyName', width: 150 },
              { title: '岗位', dataIndex: 'positionTitle', ellipsis: true },
              {
                title: '学历要求',
                dataIndex: 'educationReq',
                width: 100,
                render: (v: MatchAllItem['educationReq'], m: MatchAllItem) =>
                  v ? <Tag color={m.educationMatch === false ? 'red' : m.educationMatch ? 'green' : 'blue'}>{v}</Tag> : '-',
              },
              {
                title: '技能命中',
                key: 'skills',
                width: 180,
                render: (_: unknown, m: MatchAllItem) => (
                  <Space size={2} wrap>
                    {m.skillHits.slice(0, 4).map((s) => (
                      <Tag key={s} color="green">{s}</Tag>
                    ))}
                    {m.skillHits.length === 0 && <Typography.Text type="secondary">无</Typography.Text>}
                  </Space>
                ),
              },
              {
                title: '城市',
                dataIndex: 'city',
                width: 90,
                render: (v: MatchAllItem['city'], m: MatchAllItem) => (v ? <Tag color={m.cityMatch ? 'green' : undefined}>{v}</Tag> : '-'),
              },
              { title: '状态', dataIndex: 'status', width: 100, render: (s: MatchAllItem['status']) => <StatusTag status={s} /> },
              { title: '截止日期', dataIndex: 'deadline', width: 100, render: (v: MatchAllItem['deadline']) => formatDate(v) },
            ]}
          />
        ) : (
          <Table<Application>
            rowKey="id"
            loading={isLoading}
            dataSource={data?.items ?? []}
            onRow={(row) => ({ onClick: () => navigate(`/applications/${row.id}`), style: { cursor: 'pointer' } })}
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (page, pageSize) => filters.set({ page, pageSize }),
            }}
            columns={[
              { title: '公司', dataIndex: 'companyName', width: 160 },
              { title: '岗位', dataIndex: 'positionTitle', ellipsis: true },
              { title: '状态', dataIndex: 'status', width: 110, render: (s: Application['status']) => <StatusTag status={s} /> },
              {
                title: '优先级',
                dataIndex: 'priority',
                width: 80,
                render: (p: Priority) => <Tag color={PRIORITY_COLORS[p]}>{PRIORITY_LABELS[p]}</Tag>,
              },
              { title: '类型', dataIndex: 'jobType', width: 70, render: (v: JobType) => JOB_TYPE_LABELS[v] },
              { title: '渠道', dataIndex: 'channel', width: 90, render: (v: Application['channel']) => v || '-' },
              { title: '投递日期', dataIndex: 'appliedAt', width: 100, render: (v: Application['appliedAt']) => formatDate(v) },
              {
                title: '截止日期',
                dataIndex: 'deadline',
                width: 110,
                render: (v: Application['deadline']) =>
                  v && v < new Date().toISOString().slice(0, 10) ? (
                    <Typography.Text type="danger">{formatDate(v)}</Typography.Text>
                  ) : (
                    formatDate(v)
                  ),
              },
              { title: '更新时间', dataIndex: 'updatedAt', width: 140, render: (v: Application['updatedAt']) => formatDateTime(v) },
              {
                title: '操作',
                key: 'actions',
                width: 130,
                render: (_: unknown, row: Application) => (
                  <span onClick={(e) => e.stopPropagation()}>
                    <TransitionButton applicationId={row.id} status={row.status} />
                  </span>
                ),
              },
            ]}
          />
        )}
      </Space>
      <ApplicationFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <ImportResultModal result={importResult} onClose={() => setImportResult(null)} />

      <Modal
        title="AI Offer 对比"
        open={offerCompareOpen}
        onCancel={() => {
          setOfferCompareOpen(false);
          setOfferResult(null);
        }}
        width={760}
        footer={
          <Space>
            <Button
              type="primary"
              loading={offerLoading}
              disabled={offerSelected.length < 2}
              onClick={async () => {
                setOfferLoading(true);
                setOfferResult(null);
                try {
                  const r = await aiApi.compareOffers(offerSelected);
                  setOfferResult(r);
                } catch (err) {
                  message.error(err instanceof Error ? err.message : '对比失败（需配置 LLM）');
                } finally {
                  setOfferLoading(false);
                }
              }}
            >
              开始对比
            </Button>
            <Button onClick={() => { setOfferCompareOpen(false); setOfferResult(null); }}>关闭</Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">选择 2-3 个 Offer（OFFER/已签约状态）做多维对比与谈薪建议：</Typography.Paragraph>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          maxCount={3}
          value={offerSelected}
          onChange={setOfferSelected}
          options={offers.map((o) => ({ value: o.id, label: `${o.companyName} · ${o.positionTitle}${o.note ? `（${o.note.slice(0, 30)}）` : ''}` }))}
        />
        {offerResult && (
          <div style={{ marginTop: 12 }}>
            {offerResult.ruleBased && (
              <Typography.Text type="warning">{offerResult.recommendation}</Typography.Text>
            )}
            {offerResult.comparison.map((c) => (
              <Card key={c.company} size="small" style={{ marginBottom: 8 }}>
                <Space align="center">
                  <Typography.Text strong>{c.company} · {c.positionTitle}</Typography.Text>
                  <Tag color={c.score >= 70 ? 'green' : 'orange'}>{c.score} 分</Tag>
                </Space>
                {c.pros.length > 0 && (
                  <div style={{ fontSize: 12 }}>✅ {c.pros.join('；')}</div>
                )}
                {c.cons.length > 0 && (
                  <div style={{ fontSize: 12 }}>⚠️ {c.cons.join('；')}</div>
                )}
              </Card>
            ))}
            {offerResult.recommendation && (
              <Card size="small" style={{ marginTop: 8 }}>
                <Typography.Text strong>💡 综合推荐：</Typography.Text>
                <Typography.Paragraph style={{ marginBottom: 4 }}>{offerResult.recommendation}</Typography.Paragraph>
                {offerResult.salaryAdvice && (
                  <>
                    <Typography.Text strong>💰 谈薪建议：</Typography.Text>
                    <Typography.Paragraph style={{ marginBottom: 4 }}>{offerResult.salaryAdvice}</Typography.Paragraph>
                  </>
                )}
                {offerResult.summary && <Typography.Text type="secondary">{offerResult.summary}</Typography.Text>}
              </Card>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
