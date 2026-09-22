import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { recommendationsApi, resumesApi } from '../api';
import type {
  JobRecommendation,
  ManualRecommendationInput,
  RecommendationStatus,
  SearchProfile,
  SearchProfileInput,
} from '../types';

const { Paragraph, Text, Title } = Typography;

const STATUS_META: Record<RecommendationStatus, { label: string; color: string }> = {
  new: { label: '新推荐', color: 'blue' },
  saved: { label: '已收藏', color: 'gold' },
  dismissed: { label: '已忽略', color: 'default' },
  imported: { label: '已导入', color: 'green' },
};

const FREQUENCY_LABEL: Record<SearchProfile['frequency'], string> = {
  manual: '仅手动',
  daily: '每天',
  weekly: '每周',
};

type ProfileFormValues = Omit<SearchProfileInput, 'enabled' | 'autoImport'> & {
  enabled: boolean;
  autoImport: boolean;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function asSafeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function scoreColor(score: number) {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#1677ff';
  return '#fa8c16';
}

export default function Recommendations() {
  const queryClient = useQueryClient();
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [manualForm] = Form.useForm<ManualRecommendationInput>();
  const [selectedProfileId, setSelectedProfileId] = useState<number>();
  const [status, setStatus] = useState<RecommendationStatus | undefined>('new');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SearchProfile | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [viewingJd, setViewingJd] = useState<JobRecommendation | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [runningProfileId, setRunningProfileId] = useState<number>();
  const [pendingAction, setPendingAction] = useState<string>();

  const profilesQuery = useQuery({
    queryKey: ['recommendation-profiles'],
    queryFn: recommendationsApi.profiles,
  });
  const resumesQuery = useQuery({ queryKey: ['resumes'], queryFn: resumesApi.list });
  const profiles = useMemo(() => profilesQuery.data?.items ?? [], [profilesQuery.data]);
  const resumes = resumesQuery.data?.items ?? [];
  const selectedProfile = profiles.find((item) => item.id === selectedProfileId);

  useEffect(() => {
    if (selectedProfileId && profiles.some((profile) => profile.id === selectedProfileId)) return;
    setSelectedProfileId(profiles[0]?.id);
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [selectedProfileId, status]);

  const recommendationsQuery = useQuery({
    queryKey: ['recommendations', selectedProfileId, status, page],
    queryFn: () =>
      recommendationsApi.list({
        profileId: selectedProfileId,
        status,
        page,
        pageSize: 12,
      }),
    enabled: Boolean(selectedProfileId),
  });

  const linkedinPlanQuery = useQuery({
    queryKey: ['recommendation-linkedin-plan', selectedProfileId],
    queryFn: () => recommendationsApi.linkedinPlan(selectedProfileId!),
    enabled: Boolean(selectedProfileId),
  });

  const runsQuery = useQuery({
    queryKey: ['recommendation-runs', selectedProfileId],
    queryFn: () => recommendationsApi.runs({ profileId: selectedProfileId, page: 1, pageSize: 5 }),
    enabled: Boolean(selectedProfileId),
  });

  const invalidateRecommendations = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['recommendations'] }),
      queryClient.invalidateQueries({ queryKey: ['recommendation-runs'] }),
      queryClient.invalidateQueries({ queryKey: ['recommendation-profiles'] }),
    ]);
  };

  const invalidateImportedData = async () => {
    await Promise.all([
      invalidateRecommendations(),
      queryClient.invalidateQueries({ queryKey: ['applications'] }),
      queryClient.invalidateQueries({ queryKey: ['stats'] }),
      queryClient.invalidateQueries({ queryKey: ['companies'] }),
    ]);
  };

  const openCreateProfile = () => {
    setEditingProfile(null);
    profileForm.resetFields();
    profileForm.setFieldsValue({
      sourceIds: ['nowcoder'],
      recruitType: 'school',
      minScore: 65,
      maxPages: 3,
      frequency: 'manual',
      enabled: true,
      autoImport: false,
    });
    setProfileModalOpen(true);
  };

  const openEditProfile = (profile: SearchProfile) => {
    setEditingProfile(profile);
    profileForm.setFieldsValue({
      resumeId: profile.resumeId,
      name: profile.name,
      keywords: profile.keywords,
      cities: profile.cities,
      sourceIds: profile.sourceIds,
      recruitType: profile.recruitType,
      minScore: profile.minScore,
      maxPages: profile.maxPages,
      frequency: profile.frequency,
      enabled: Boolean(profile.enabled),
      autoImport: Boolean(profile.autoImport),
    });
    setProfileModalOpen(true);
  };

  const persistProfile = async (values: ProfileFormValues) => {
    const payload: SearchProfileInput = {
      ...values,
      keywords: values.keywords?.length ? values.keywords : editingProfile ? [] : undefined,
      cities: values.cities?.length ? values.cities : editingProfile ? [] : undefined,
      sourceIds: values.sourceIds ?? ['nowcoder'],
      enabled: values.enabled,
      autoImport: values.autoImport,
    };
    setProfileSaving(true);
    try {
      const saved = editingProfile
        ? await recommendationsApi.updateProfile(editingProfile.id, payload)
        : await recommendationsApi.createProfile(payload);
      await queryClient.invalidateQueries({ queryKey: ['recommendation-profiles'] });
      setSelectedProfileId(saved.id);
      setProfileModalOpen(false);
      message.success(editingProfile ? '找岗画像已更新' : '找岗画像已创建');
    } catch (error) {
      message.error(getErrorMessage(error, '保存画像失败'));
    } finally {
      setProfileSaving(false);
    }
  };

  const submitProfile = async () => {
    const values = await profileForm.validateFields();
    if (!values.autoImport) {
      await persistProfile(values);
      return;
    }
    Modal.confirm({
      title: '确认开启自动导入？',
      content: '运行画像时，达到最低匹配分的岗位会直接进入投递管理。建议先关闭此选项观察推荐质量。',
      okText: '确认开启并保存',
      cancelText: '返回检查',
      onOk: () => persistProfile(values),
    });
  };

  const removeProfile = async (profile: SearchProfile) => {
    setPendingAction(`delete-${profile.id}`);
    try {
      await recommendationsApi.removeProfile(profile.id);
      if (selectedProfileId === profile.id) setSelectedProfileId(undefined);
      await queryClient.invalidateQueries({ queryKey: ['recommendation-profiles'] });
      message.success('画像已删除');
    } catch (error) {
      message.error(getErrorMessage(error, '删除画像失败'));
    } finally {
      setPendingAction(undefined);
    }
  };

  const runProfile = async (profile: SearchProfile) => {
    setRunningProfileId(profile.id);
    try {
      const result = await recommendationsApi.runProfile(profile.id);
      await invalidateRecommendations();
      if (result.status === 'failed') {
        message.error(result.error || '找岗运行失败');
      } else {
        message.success(
          `运行完成：抓取 ${result.fetched} 条，匹配 ${result.matched} 条，保存/更新 ${result.saved} 条${
            result.imported ? `，导入 ${result.imported} 条` : ''
          }`,
        );
      }
    } catch (error) {
      message.error(getErrorMessage(error, '运行画像失败'));
    } finally {
      setRunningProfileId(undefined);
    }
  };

  const requestRun = (profile: SearchProfile) => {
    if (!profile.autoImport) {
      void runProfile(profile);
      return;
    }
    Modal.confirm({
      title: '运行会自动导入匹配岗位',
      content: `此画像已开启自动导入，达到 ${profile.minScore} 分的岗位会进入投递管理。是否继续？`,
      okText: '确认运行',
      cancelText: '取消',
      onOk: () => runProfile(profile),
    });
  };

  const updateStatus = async (
    recommendation: JobRecommendation,
    nextStatus: 'new' | 'saved' | 'dismissed',
  ) => {
    setPendingAction(`status-${recommendation.id}`);
    try {
      await recommendationsApi.setStatus(recommendation.id, nextStatus);
      setSelectedIds((ids) => ids.filter((id) => id !== recommendation.id));
      await queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      message.success(nextStatus === 'saved' ? '已收藏' : nextStatus === 'dismissed' ? '已忽略' : '已恢复为新推荐');
    } catch (error) {
      message.error(getErrorMessage(error, '更新推荐状态失败'));
    } finally {
      setPendingAction(undefined);
    }
  };

  const importOne = async (recommendation: JobRecommendation) => {
    setPendingAction(`import-${recommendation.id}`);
    try {
      const result = await recommendationsApi.importOne(recommendation.id);
      setSelectedIds((ids) => ids.filter((id) => id !== recommendation.id));
      await invalidateImportedData();
      message.success(result.imported ? '已导入投递管理' : '该岗位已存在，已关联现有投递');
    } catch (error) {
      message.error(getErrorMessage(error, '导入岗位失败'));
    } finally {
      setPendingAction(undefined);
    }
  };

  const importSelected = async () => {
    if (!selectedIds.length) return;
    setPendingAction('import-batch');
    try {
      const result = await recommendationsApi.importBatch(selectedIds);
      setSelectedIds([]);
      await invalidateImportedData();
      if (result.errors.length) {
        message.warning(`导入 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.errors.length} 条`);
      } else {
        message.success(`已导入 ${result.imported} 条，跳过 ${result.skipped} 条`);
      }
    } catch (error) {
      message.error(getErrorMessage(error, '批量导入失败'));
    } finally {
      setPendingAction(undefined);
    }
  };

  const openManualModal = () => {
    manualForm.resetFields();
    manualForm.setFieldsValue({
      profileId: selectedProfileId,
      sourceId: 'linkedin-manual',
      channel: 'LinkedIn（手动粘贴）',
      jobType: selectedProfile?.recruitType ?? 'school',
    });
    setManualModalOpen(true);
  };

  const submitManual = async () => {
    const values = await manualForm.validateFields();
    const payload: ManualRecommendationInput = {
      ...values,
      jdUrl: values.jdUrl?.trim() || undefined,
      deadline: values.deadline?.trim() || undefined,
      salary: values.salary?.trim() || undefined,
      city: values.city?.trim() || undefined,
      jdDescription: values.jdDescription?.trim() || undefined,
    };
    setManualSaving(true);
    try {
      await recommendationsApi.addManual(payload);
      await queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      setStatus(undefined);
      setPage(1);
      setManualModalOpen(false);
      message.success('岗位已加入推荐中心并完成匹配');
    } catch (error) {
      message.error(getErrorMessage(error, '添加岗位失败'));
    } finally {
      setManualSaving(false);
    }
  };

  const copyQuery = async (queryText: string) => {
    try {
      await navigator.clipboard.writeText(queryText);
      message.success('搜索词已复制，请在 LinkedIn Jobs 中自行粘贴搜索');
    } catch {
      message.error('复制失败，请手动选择搜索词复制');
    }
  };

  const recommendationItems = recommendationsQuery.data?.items ?? [];
  const selectableIds = recommendationItems
    .filter((item) => item.status === 'new' || item.status === 'saved')
    .map((item) => item.id);
  const allVisibleSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  if (profilesQuery.isLoading || resumesQuery.isLoading) {
    return (
      <div role="status" style={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
        <Space direction="vertical" align="center">
          <Spin size="large" />
          <Text>正在加载智能推荐中心…</Text>
        </Space>
      </div>
    );
  }

  if (profilesQuery.isError || resumesQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="智能推荐中心加载失败"
        description={getErrorMessage(profilesQuery.error ?? resumesQuery.error, '请检查后端服务后重试')}
        action={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void profilesQuery.refetch();
              void resumesQuery.refetch();
            }}
          >
            重试
          </Button>
        }
      />
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small">
        <Row gutter={[16, 12]} align="middle" justify="space-between">
          <Col flex="auto">
            <Title level={3} style={{ margin: 0 }}>
              <RobotOutlined /> 智能推荐中心
            </Title>
            <Text type="secondary">从简历画像生成找岗条件，抓取公开岗位后评分，由你决定收藏、忽略或导入。</Text>
          </Col>
          <Col>
            <Space wrap>
              <Button icon={<PlusOutlined />} onClick={openManualModal} disabled={!selectedProfile}>
                粘贴岗位
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProfile} disabled={!resumes.length}>
                新建画像
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {!resumes.length && (
        <Alert
          type="warning"
          showIcon
          message="请先创建一份简历"
          description={<span>智能推荐需要简历作为匹配依据。请前往 <Link to="/resumes">简历管理</Link> 创建或导入简历。</span>}
        />
      )}

      {!profiles.length ? (
        <Card>
          <Empty
            image={<InboxOutlined style={{ fontSize: 56, color: '#bfbfbf' }} />}
            description={
              <Space direction="vertical" size={2}>
                <Text strong>还没有找岗画像</Text>
                <Text type="secondary">选择简历并设定目标城市、岗位和匹配分，即可开始找岗。</Text>
              </Space>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProfile} disabled={!resumes.length}>
              创建第一个画像
            </Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={8}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Card size="small" title="找岗画像">
                <Select
                  value={selectedProfileId}
                  onChange={setSelectedProfileId}
                  style={{ width: '100%' }}
                  aria-label="选择找岗画像"
                  options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                />
                {selectedProfile && (
                  <>
                    <Divider style={{ margin: '14px 0' }} />
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color={selectedProfile.enabled ? 'green' : 'default'}>
                          {selectedProfile.enabled ? '定时任务已启用' : '定时任务已停用'}
                        </Tag>
                        <Tag>{FREQUENCY_LABEL[selectedProfile.frequency]}</Tag>
                        {selectedProfile.autoImport ? <Tag color="orange">自动导入</Tag> : <Tag>人工确认导入</Tag>}
                      </Space>
                      <Descriptions size="small" column={1} colon={false}>
                        <Descriptions.Item label="关键词">
                          {selectedProfile.keywords.length ? selectedProfile.keywords.join('、') : '由简历自动生成'}
                        </Descriptions.Item>
                        <Descriptions.Item label="城市">
                          {selectedProfile.cities.length ? selectedProfile.cities.join('、') : '不限'}
                        </Descriptions.Item>
                        <Descriptions.Item label="条件">
                          {selectedProfile.recruitType === 'intern' ? '实习' : '校招'} · ≥{selectedProfile.minScore} 分 · 最多 {selectedProfile.maxPages} 页
                        </Descriptions.Item>
                      </Descriptions>
                      <Button
                        type="primary"
                        block
                        icon={<SearchOutlined />}
                        loading={runningProfileId === selectedProfile.id}
                        disabled={Boolean(runningProfileId)}
                        onClick={() => requestRun(selectedProfile)}
                      >
                        立即运行画像
                      </Button>
                      <Space wrap>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEditProfile(selectedProfile)}>
                          编辑
                        </Button>
                        <Popconfirm
                          title="删除这个找岗画像？"
                          description="画像及推荐记录将被删除，已导入的投递不会受影响。"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true, loading: pendingAction === `delete-${selectedProfile.id}` }}
                          onConfirm={() => removeProfile(selectedProfile)}
                        >
                          <Button size="small" danger icon={<DeleteOutlined />}>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    </Space>
                  </>
                )}
              </Card>

              <Card size="small" title="最近运行">
                {runsQuery.isLoading ? (
                  <Spin />
                ) : runsQuery.isError ? (
                  <Alert
                    type="error"
                    showIcon
                    message="运行记录加载失败"
                    action={<Button size="small" onClick={() => void runsQuery.refetch()}>重试</Button>}
                  />
                ) : !runsQuery.data?.items.length ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未运行" />
                ) : (
                  <List
                    size="small"
                    dataSource={runsQuery.data.items}
                    renderItem={(run) => (
                      <List.Item>
                        <Space direction="vertical" size={0} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color={run.status === 'success' ? 'green' : run.status === 'failed' ? 'red' : 'processing'}>
                              {run.status === 'success' ? '成功' : run.status === 'failed' ? '失败' : '运行中'}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {new Date(run.startedAt).toLocaleString('zh-CN')}
                            </Text>
                          </Space>
                          <Text style={{ fontSize: 12 }}>
                            抓取 {run.fetched} · 匹配 {run.matched} · 新增 {run.saved} · 导入 {run.imported}
                          </Text>
                          {run.error && <Text type="danger" style={{ fontSize: 12 }}>{run.error}</Text>}
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Space>
          </Col>

          <Col xs={24} xl={16}>
            <Card
              size="small"
              title="推荐岗位"
              extra={
                <Space wrap>
                  <Select
                    aria-label="筛选推荐状态"
                    value={status ?? 'all'}
                    onChange={(value) => setStatus(value === 'all' ? undefined : value as RecommendationStatus)}
                    style={{ width: 120 }}
                    options={[
                      { value: 'all', label: '全部状态' },
                      ...Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label })),
                    ]}
                  />
                  <Button icon={<ReloadOutlined />} onClick={() => void recommendationsQuery.refetch()}>
                    刷新
                  </Button>
                </Space>
              }
            >
              {recommendationsQuery.isLoading ? (
                <div role="status" style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
                  <Spin tip="正在加载推荐…" />
                </div>
              ) : recommendationsQuery.isError ? (
                <Alert
                  type="error"
                  showIcon
                  message="推荐岗位加载失败"
                  description={getErrorMessage(recommendationsQuery.error, '请稍后重试')}
                  action={<Button icon={<ReloadOutlined />} onClick={() => void recommendationsQuery.refetch()}>重试</Button>}
                />
              ) : !recommendationItems.length ? (
                <Empty
                  description={
                    status === 'new'
                      ? '暂无新推荐。可以运行画像，或主动粘贴一个岗位。'
                      : '当前筛选条件下没有推荐。'
                  }
                >
                  <Space wrap>
                    <Button icon={<SearchOutlined />} onClick={() => selectedProfile && requestRun(selectedProfile)}>
                      运行画像
                    </Button>
                    <Button icon={<PlusOutlined />} onClick={openManualModal}>粘贴岗位</Button>
                  </Space>
                </Empty>
              ) : (
                <>
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Checkbox
                      checked={allVisibleSelected}
                      indeterminate={selectedIds.length > 0 && !allVisibleSelected}
                      onChange={(event) => {
                        setSelectedIds(event.target.checked ? selectableIds : []);
                      }}
                      disabled={!selectableIds.length}
                    >
                      选择本页可导入岗位
                    </Checkbox>
                    <Button
                      type="primary"
                      icon={<ExportOutlined />}
                      disabled={!selectedIds.length}
                      loading={pendingAction === 'import-batch'}
                      onClick={importSelected}
                    >
                      批量导入（{selectedIds.length}）
                    </Button>
                  </Space>
                  <List
                    dataSource={recommendationItems}
                    renderItem={(item) => {
                      const safeUrl = asSafeExternalUrl(item.jdUrl);
                      const selectable = item.status === 'new' || item.status === 'saved';
                      return (
                        <List.Item style={{ display: 'block', padding: '8px 0' }}>
                          <Card size="small" styles={{ body: { padding: 14 } }}>
                            <Row gutter={[14, 12]} align="middle">
                              <Col xs={2} sm={1}>
                                {selectable && (
                                  <Checkbox
                                    aria-label={`选择 ${item.companyName} ${item.positionTitle}`}
                                    checked={selectedIds.includes(item.id)}
                                    onChange={(event) => {
                                      setSelectedIds((ids) =>
                                        event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                                      );
                                    }}
                                  />
                                )}
                              </Col>
                              <Col xs={22} sm={5} md={4} style={{ textAlign: 'center' }}>
                                <Progress
                                  type="circle"
                                  size={68}
                                  percent={item.score}
                                  strokeColor={scoreColor(item.score)}
                                  format={(value) => <span style={{ fontSize: 16, fontWeight: 700 }}>{value}分</span>}
                                />
                              </Col>
                              <Col xs={24} sm={18} md={19}>
                                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                  <Space wrap>
                                    <Text strong style={{ fontSize: 16 }}>{item.positionTitle}</Text>
                                    <Tag color={STATUS_META[item.status].color}>{STATUS_META[item.status].label}</Tag>
                                    <Tag>{item.sourceId === 'linkedin-manual' ? 'LinkedIn 手动' : item.sourceId}</Tag>
                                  </Space>
                                  <Space wrap split={<Text type="secondary">·</Text>}>
                                    <Text>{item.companyName}</Text>
                                    {(item.city || item.companyCity) && <Text>{item.city || item.companyCity}</Text>}
                                    {item.salary && <Text>{item.salary}</Text>}
                                    <Text>{item.jobType === 'intern' ? '实习' : '校招'}</Text>
                                  </Space>
                                  {item.summary && <Paragraph style={{ margin: 0 }}>{item.summary}</Paragraph>}
                                  {item.reasons.length > 0 && (
                                    <Space wrap size={[4, 4]}>
                                      {item.reasons.slice(0, 4).map((reason) => <Tag key={reason}>{reason}</Tag>)}
                                    </Space>
                                  )}
                                  <Space wrap>
                                    {(item.jdDescription || safeUrl) && (
                                      <Button size="small" icon={<LinkOutlined />} onClick={() => setViewingJd(item)}>
                                        查看 JD
                                      </Button>
                                    )}
                                    {item.status === 'new' && (
                                      <Button
                                        size="small"
                                        icon={<SaveOutlined />}
                                        loading={pendingAction === `status-${item.id}`}
                                        onClick={() => updateStatus(item, 'saved')}
                                      >
                                        收藏
                                      </Button>
                                    )}
                                    {(item.status === 'new' || item.status === 'saved') && (
                                      <Button
                                        size="small"
                                        icon={<StopOutlined />}
                                        loading={pendingAction === `status-${item.id}`}
                                        onClick={() => updateStatus(item, 'dismissed')}
                                      >
                                        忽略
                                      </Button>
                                    )}
                                    {item.status === 'dismissed' && (
                                      <Button
                                        size="small"
                                        loading={pendingAction === `status-${item.id}`}
                                        onClick={() => updateStatus(item, 'new')}
                                      >
                                        恢复
                                      </Button>
                                    )}
                                    {selectable && (
                                      <Button
                                        type="primary"
                                        size="small"
                                        icon={<ExportOutlined />}
                                        loading={pendingAction === `import-${item.id}`}
                                        onClick={() => importOne(item)}
                                      >
                                        导入投递
                                      </Button>
                                    )}
                                    {item.status === 'imported' && item.applicationId && (
                                      <Link to={`/applications/${item.applicationId}`}>查看投递</Link>
                                    )}
                                  </Space>
                                </Space>
                              </Col>
                            </Row>
                          </Card>
                        </List.Item>
                      );
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, overflowX: 'auto' }}>
                    <Pagination
                      current={recommendationsQuery.data?.page ?? page}
                      pageSize={recommendationsQuery.data?.pageSize ?? 12}
                      total={recommendationsQuery.data?.total ?? 0}
                      showSizeChanger={false}
                      showTotal={(total) => `共 ${total} 条`}
                      onChange={(nextPage) => {
                        setSelectedIds([]);
                        setPage(nextPage);
                      }}
                    />
                  </div>
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {selectedProfile && (
        <Card
          title={<Space><span aria-hidden="true">in</span><span>LinkedIn 合规找岗助手</span></Space>}
          size="small"
          extra={
            <Button
              type="primary"
              icon={<ExportOutlined />}
              href="https://www.linkedin.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              打开 LinkedIn
            </Button>
          }
        >
          <Alert
            type="warning"
            showIcon
            message="仅提供人工辅助，不抓取 LinkedIn，也不会自动申请"
            description="请复制下方搜索词，在 LinkedIn Jobs 页面自行粘贴搜索；查看岗位后可把信息主动粘贴回本应用。最终申请与提交始终由你本人完成。"
            style={{ marginBottom: 16 }}
          />
          {linkedinPlanQuery.isLoading ? (
            <Spin tip="正在生成搜索词…" />
          ) : linkedinPlanQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message="搜索方案生成失败"
              description={getErrorMessage(linkedinPlanQuery.error, '请稍后重试')}
              action={<Button size="small" onClick={() => void linkedinPlanQuery.refetch()}>重试</Button>}
            />
          ) : (
            <>
              {linkedinPlanQuery.data?.notice && <Paragraph type="secondary">{linkedinPlanQuery.data.notice}</Paragraph>}
              <Row gutter={[12, 12]}>
                {linkedinPlanQuery.data?.queries.map((query, index) => (
                  <Col xs={24} md={12} xl={8} key={`${query.queryText}-${index}`}>
                    <Card size="small" style={{ height: '100%' }}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag color="blue">{query.keywords}</Tag>
                          {query.location && <Tag>{query.location}</Tag>}
                        </Space>
                        <Text code style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{query.queryText}</Text>
                        <Button block icon={<CopyOutlined />} onClick={() => copyQuery(query.queryText)}>
                          复制搜索词
                        </Button>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
              {!linkedinPlanQuery.data?.queries.length && (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="画像暂未生成搜索词，请补充关键词后重试" />
              )}
              <Divider />
              <Space wrap>
                <Text>已经找到合适岗位？</Text>
                <Button type="primary" icon={<PlusOutlined />} onClick={openManualModal}>
                  主动粘贴岗位信息
                </Button>
              </Space>
            </>
          )}
        </Card>
      )}

      <Modal
        title={editingProfile ? '编辑找岗画像' : '新建找岗画像'}
        open={profileModalOpen}
        width={720}
        okText="保存画像"
        cancelText="取消"
        confirmLoading={profileSaving}
        onOk={submitProfile}
        onCancel={() => setProfileModalOpen(false)}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          message="关键词和城市可以留空"
          description="留空时后端会根据所选简历生成搜索条件；你也可以手动补充多个标签。"
          style={{ marginBottom: 16 }}
        />
        <Form form={profileForm} layout="vertical" requiredMark="optional">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="画像名称" rules={[{ required: true, message: '请输入画像名称' }, { max: 100 }]}> 
                <Input placeholder="如：伦敦后端校招" maxLength={100} showCount />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="resumeId" label="匹配简历" rules={[{ required: true, message: '请选择简历' }]}> 
                <Select
                  placeholder="选择一份简历"
                  options={resumes.map((resume) => ({
                    value: resume.id,
                    label: resume.targetRole ? `${resume.name} · ${resume.targetRole}` : resume.name,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="keywords" label="岗位关键词">
            <Select mode="tags" tokenSeparators={[',', '，']} placeholder="如：Backend Engineer、Java；回车添加" />
          </Form.Item>
          <Form.Item name="cities" label="目标城市">
            <Select mode="tags" tokenSeparators={[',', '，']} placeholder="如：London、上海；留空表示不限" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="recruitType" label="招聘类型" rules={[{ required: true }]}> 
                <Select options={[{ value: 'school', label: '校招' }, { value: 'intern', label: '实习' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="minScore" label="最低匹配分" rules={[{ required: true }]}> 
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="maxPages" label="每词抓取页数" rules={[{ required: true }]}> 
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="frequency" label="运行频率" rules={[{ required: true }]}> 
                <Select options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="sourceIds" label="岗位数据源" rules={[{ required: true, message: '请至少选择一个数据源' }]}> 
            <Checkbox.Group options={[{ label: '牛客网', value: 'nowcoder' }]} />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="enabled" label="启用定时任务" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="autoImport" label="达到最低分后自动导入" valuePropName="checked">
                <Switch checkedChildren="自动导入" unCheckedChildren="人工确认" />
              </Form.Item>
            </Col>
          </Row>
          <Alert
            type="warning"
            showIcon
            message="建议使用人工确认"
            description="自动导入会在运行画像时直接创建投递记录。开启前请先通过几轮推荐检查匹配质量。"
          />
        </Form>
      </Modal>

      <Modal
        title="主动粘贴岗位"
        open={manualModalOpen}
        width={760}
        okText="加入并匹配"
        cancelText="取消"
        confirmLoading={manualSaving}
        onOk={submitManual}
        onCancel={() => setManualModalOpen(false)}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          message="信息只由你主动提供"
          description="应用不会访问你的 LinkedIn 账号，也不会代你抓取或投递。建议至少粘贴完整 JD，以获得更准确的简历匹配分。"
          style={{ marginBottom: 16 }}
        />
        <Form form={manualForm} layout="vertical" requiredMark="optional">
          <Form.Item name="profileId" label="匹配画像" rules={[{ required: true, message: '请选择画像' }]}> 
            <Select options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} />
          </Form.Item>
          <Form.Item name="sourceId" hidden><Input /></Form.Item>
          <Form.Item name="channel" hidden><Input /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="companyName" label="公司" rules={[{ required: true, message: '请输入公司名称' }, { max: 200 }]}> 
                <Input placeholder="公司名称" maxLength={200} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="positionTitle" label="岗位" rules={[{ required: true, message: '请输入岗位名称' }, { max: 200 }]}> 
                <Input placeholder="岗位名称" maxLength={200} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item name="city" label="城市"><Input placeholder="如：London" maxLength={100} /></Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="salary" label="薪资"><Input placeholder="如：£45k–£55k" maxLength={100} /></Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="jobType" label="类型">
                <Select options={[{ value: 'school', label: '校招' }, { value: 'intern', label: '实习' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="jdUrl"
            label="岗位链接"
            rules={[
              {
                validator: (_, value?: string) =>
                  !value || /^https?:\/\//i.test(value.trim())
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入完整的 http(s) 链接')),
              },
            ]}
          >
            <Input placeholder="https://www.linkedin.com/jobs/view/..." maxLength={1000} />
          </Form.Item>
          <Form.Item
            name="jdDescription"
            label="岗位描述（JD）"
            rules={[{ required: true, whitespace: true, message: '请粘贴岗位描述以完成匹配' }]}
          >
            <Input.TextArea rows={9} placeholder="粘贴岗位职责、任职要求等内容" maxLength={10_000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={viewingJd ? `${viewingJd.companyName} · ${viewingJd.positionTitle}` : '岗位描述'}
        open={Boolean(viewingJd)}
        width={Math.min(680, typeof window === 'undefined' ? 680 : window.innerWidth)}
        onClose={() => setViewingJd(null)}
        extra={
          viewingJd && asSafeExternalUrl(viewingJd.jdUrl) ? (
            <Button
              icon={<ExportOutlined />}
              href={asSafeExternalUrl(viewingJd.jdUrl)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开原页面
            </Button>
          ) : null
        }
      >
        {viewingJd && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="匹配分">{viewingJd.score}</Descriptions.Item>
              <Descriptions.Item label="城市">{viewingJd.city || viewingJd.companyCity || '-'}</Descriptions.Item>
              <Descriptions.Item label="薪资">{viewingJd.salary || '-'}</Descriptions.Item>
              <Descriptions.Item label="来源">{viewingJd.sourceId}</Descriptions.Item>
            </Descriptions>
            <div>
              <Title level={5}>岗位描述</Title>
              {viewingJd.jdDescription ? (
                <Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{viewingJd.jdDescription}</Paragraph>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有保存 JD 全文，请打开原页面查看" />
              )}
            </div>
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
