import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Progress, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { ExperimentOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aiApi, resumesApi, sourcesApi } from '../api';
import ImportResultModal from '../components/ImportResultModal';
import CrawlJobsPanel from '../components/CrawlJobsPanel';
import type { ImportResult, RawJobRecord } from '../types';

export default function Sources() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [records, setRecords] = useState<RawJobRecord[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [autoImport, setAutoImport] = useState(false);
  const [aggregate, setAggregate] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [matchScores, setMatchScores] = useState<Record<string, number> | null>(null);
  const [matchResumeId, setMatchResumeId] = useState<number | undefined>(undefined);
  const [matching, setMatching] = useState(false);

  const { data: sourcesData } = useQuery({ queryKey: ['sources'], queryFn: sourcesApi.list });
  const { data: resumesData } = useQuery({ queryKey: ['resumes'], queryFn: resumesApi.list });
  const sources = sourcesData?.items ?? [];
  const source = sources[0];
  const resumes = resumesData?.items ?? [];

  const keyOf = (r: RawJobRecord) => r.sourceKey ?? `${r.companyName}|${r.positionTitle}`;
  const sortedRecords = useMemo(() => {
    if (!matchScores) return records;
    return [...records].sort((a, b) => (matchScores[keyOf(b)] ?? 0) - (matchScores[keyOf(a)] ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, matchScores]);
  const highScoreKeys = (threshold: number) => records.filter((r) => (matchScores?.[keyOf(r)] ?? 0) >= threshold).map(keyOf);

  const handleMatch = async () => {
    if (!matchResumeId) return;
    setMatching(true);
    try {
      const results = await aiApi.matchBatch(matchResumeId, records.slice(0, 50));
      const map: Record<string, number> = {};
      for (const r of results) map[r.sourceKey ?? `${r.companyName}|${r.positionTitle}`] = r.score;
      setMatchScores(map);
      message.success(`匹配完成 ${results.length} 条${results[0]?.ruleBased ? '（规则降级，配置 LLM 可获得内容级匹配）' : ''}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '匹配失败');
    } finally {
      setMatching(false);
    }
  };

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['companies'] });
  };

  const handleCrawl = async () => {
    const values = await form.validateFields();
    setCrawling(true);
    try {
      const params = {
        keyword: values.keyword,
        recruitType: values.recruitType ?? 'school',
        maxPages: values.maxPages ?? 3,
      };
      const result = aggregate
        ? await sourcesApi.crawlMany({ sourceIds: sources.map((s) => s.id), params })
        : await sourcesApi.crawl({ sourceId: values.sourceId ?? source?.id, params });
      if (autoImport) {
        // 免确认模式：抓取后直接导入
        setRecords([]);
        if (result.records.length === 0) {
          message.info('未抓取到职位');
          return;
        }
        setImporting(true);
        try {
          const importRes = await sourcesApi.importRecords(result.records);
          setImportResult(importRes);
          invalidateData();
        } finally {
          setImporting(false);
        }
      } else {
        setRecords(result.records);
        setSelected(result.records.map((r) => r.sourceKey ?? `${r.companyName}|${r.positionTitle}`));
        message.success(`抓取到 ${result.count} 条职位，默认全选，可取消勾选后导入`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '抓取失败');
    } finally {
      setCrawling(false);
    }
  };

  const handleImport = async () => {
    const toImport = records.filter((r) => selected.includes(r.sourceKey ?? `${r.companyName}|${r.positionTitle}`));
    if (toImport.length === 0) {
      message.warning('请至少勾选一条记录');
      return;
    }
    setImporting(true);
    try {
      const result = await sourcesApi.importRecords(toImport);
      setImportResult(result);
      invalidateData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="🔎 网上自动化查找岗位"
        description="输入关键词自动抓取牛客网职位（公司/薪资/城市/JD 全文/截止日期），预览勾选或一键导入；下方「定时自动抓取」可每天/每周自动找新岗位。Boss直聘/拉勾/应届生网因 JS 挑战反爬列为实验性方案（见设计文档 06 §6）。"
      />

      {source && (
        <Card
          title={
            <Space>
              {source.name}
              {source.experimental && <Tag icon={<ExperimentOutlined />} color="orange">实验性</Tag>}
            </Space>
          }
          size="small"
        >
          <Typography.Paragraph type="secondary">{source.description}</Typography.Paragraph>
          <Form
            form={form}
            layout="inline"
            initialValues={{ sourceId: source.id, recruitType: 'school', maxPages: 3 }}
          >
            <Form.Item name="sourceId" hidden>
              <Input />
            </Form.Item>
            <Form.Item name="keyword" label="关键词" rules={[{ required: true, message: '请输入关键词' }]}>
              <Input placeholder="如：后端" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="recruitType" label="类型">
              <Select
                style={{ width: 110 }}
                options={[
                  { value: 'school', label: '校招' },
                  { value: 'intern', label: '实习' },
                ]}
              />
            </Form.Item>
            <Form.Item name="maxPages" label="页数">
              <InputNumber min={1} max={10} style={{ width: 80 }} />
            </Form.Item>
            <Form.Item label="聚合全部数据源">
              <Switch checked={aggregate} onChange={setAggregate} size="small" />
            </Form.Item>
            <Form.Item label="抓取后自动导入">
              <Switch checked={autoImport} onChange={setAutoImport} size="small" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" icon={<SearchOutlined />} loading={crawling || importing} onClick={handleCrawl}>
                {autoImport ? '抓取并导入' : '抓取职位'}
              </Button>
            </Form.Item>
          </Form>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            {aggregate
              ? '聚合模式：并行抓取所有已注册数据源并合并去重（当前可用源：牛客网；Boss直聘/拉勾/应届生网经调研存在 JS 挑战反爬，列为 Tier 2 实验性，见设计文档 06 §6）。'
              : '默认确认模式：抓取后预览勾选再导入；可打开上方开关切换为免确认一键导入，或开启聚合全部数据源。'}
          </Typography.Paragraph>
        </Card>
      )}

      {records.length > 0 && (
        <Card
          title={`抓取结果（${records.length} 条，已选 ${selected.length} 条）`}
          size="small"
          extra={
            <Space>
              <Select
                size="small"
                placeholder="选简历做匹配"
                style={{ width: 170 }}
                value={matchResumeId}
                onChange={setMatchResumeId}
                options={resumes.map((r) => ({ value: r.id, label: r.name }))}
              />
              <Button
                size="small"
                icon={<RobotOutlined />}
                loading={matching}
                disabled={!matchResumeId}
                onClick={handleMatch}
              >
                AI 匹配排序
              </Button>
              {matchScores && (
                <Button size="small" onClick={() => setSelected(highScoreKeys(70))}>
                  勾选 ≥70 分
                </Button>
              )}
              <Button size="small" onClick={() => setSelected(records.map((r) => r.sourceKey ?? `${r.companyName}|${r.positionTitle}`))}>
                全选
              </Button>
              <Button size="small" onClick={() => setSelected([])}>
                全不选
              </Button>
              <Button type="primary" size="small" loading={importing} onClick={handleImport}>
                导入选中
              </Button>
            </Space>
          }
        >
          <Table
            rowKey={(r) => r.sourceKey ?? `${r.companyName}|${r.positionTitle}`}
            size="small"
            dataSource={sortedRecords}
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
            columns={[
              {
                title: '',
                key: 'check',
                width: 40,
                render: (_, r) => (
                  <Checkbox
                    checked={selected.includes(r.sourceKey ?? `${r.companyName}|${r.positionTitle}`)}
                    onChange={(e) => {
                      const key = r.sourceKey ?? `${r.companyName}|${r.positionTitle}`;
                      setSelected(e.target.checked ? [...selected, key] : selected.filter((k) => k !== key));
                    }}
                  />
                ),
              },
              ...(matchScores
                ? [
                    {
                      title: '匹配度',
                      key: 'score',
                      width: 110,
                      sorter: (a: RawJobRecord, b: RawJobRecord) =>
                        (matchScores[b.sourceKey ?? ''] ?? 0) - (matchScores[a.sourceKey ?? ''] ?? 0),
                      defaultSortOrder: 'descend' as const,
                      render: (_: unknown, r: RawJobRecord) => {
                        const score = matchScores[r.sourceKey ?? ''] ?? 0;
                        return (
                          <Progress
                            size="small"
                            percent={score}
                            format={(p) => `${p}分`}
                            status={score >= 70 ? 'success' : score >= 50 ? 'normal' : 'exception'}
                          />
                        );
                      },
                    },
                  ]
                : []),
              { title: '公司', dataIndex: 'companyName', width: 180, ellipsis: true },
              { title: '岗位', dataIndex: 'positionTitle', ellipsis: true },
              { title: '薪资', dataIndex: 'salary', width: 120, render: (v) => v || '-' },
              { title: '城市', dataIndex: 'city', width: 80, render: (v) => v || '-' },
              { title: '截止日期', dataIndex: 'deadline', width: 105, render: (v) => v || '-' },
              {
                title: 'JD',
                dataIndex: 'jdUrl',
                width: 70,
                render: (v) => (
                  <a href={v} target="_blank" rel="noreferrer">
                    查看
                  </a>
                ),
              },
            ]}
          />
        </Card>
      )}

      <CrawlJobsPanel />

      <ImportResultModal result={importResult} onClose={() => setImportResult(null)} title="导入结果" />
    </Space>
  );
}
