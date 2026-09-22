import { Layout, Menu, Badge, Typography, Space } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  CalendarOutlined,
  GlobalOutlined,
  MailOutlined,
  SettingOutlined,
  ApartmentOutlined,
  IdcardOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useToday } from '../hooks';
import { usePendingEmailCount } from '../hooks';

const { Sider, Content, Header } = Layout;

const MENU_ITEMS = [
  { key: '/', icon: <DashboardOutlined />, label: '看板' },
  { key: '/applications', icon: <FileTextOutlined />, label: '投递管理' },
  { key: '/today', icon: <CalendarOutlined />, label: '今日待办' },
  { key: '/sources', icon: <GlobalOutlined />, label: '网上找岗位' },
  { key: '/recommendations', icon: <RobotOutlined />, label: '智能推荐' },
  { key: '/email', icon: <MailOutlined />, label: '邮件分析' },
  { key: '/companies', icon: <ApartmentOutlined />, label: '公司管理' },
  { key: '/resumes', icon: <IdcardOutlined />, label: '简历管理' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

/** 顶部快捷入口（窄屏折叠菜单时依然可见） */
const QUICK_NAV: Array<{ path: string; label: string }> = [
  { path: '/applications', label: '📋 投递管理' },
  { path: '/sources', label: '🔎 网上找岗位' },
  { path: '/recommendations', label: '✨ 智能推荐' },
  { path: '/resumes', label: '📄 简历' },
  { path: '/today', label: '🔔 待办' },
];

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: today } = useToday();
  const { data: pendingEmails } = usePendingEmailCount();

  const todayCount = (today?.today.length ?? 0) + (today?.overdue.length ?? 0);
  const selectedKey = MENU_ITEMS.find((m) => location.pathname === m.key || (m.key !== '/' && location.pathname.startsWith(m.key)))?.key ?? '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0" width={200}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, textAlign: 'center', padding: '18px 8px' }}>
          🎯 FindJob
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(key)}
          items={MENU_ITEMS.map((m) => ({
            ...m,
            label:
              m.key === '/today' && todayCount > 0 ? (
                <Badge count={todayCount} size="small" offset={[10, 0]}>
                  {m.label}
                </Badge>
              ) : m.key === '/email' && (pendingEmails ?? 0) > 0 ? (
                <Badge count={pendingEmails} size="small" offset={[10, 0]}>
                  {m.label}
                </Badge>
              ) : (
                m.label
              ),
          }))}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', height: 'auto', minHeight: 64 }}>
          <Space align="center" wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              秋招进度实时追踪
            </Typography.Title>
            {QUICK_NAV.map((q) => (
              <Link key={q.path} to={q.path} style={{ fontSize: 13 }}>
                {q.label}
              </Link>
            ))}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            单用户本地应用 · 数据存储于本地 SQLite
          </Typography.Text>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
