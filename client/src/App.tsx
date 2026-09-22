import { lazy, Suspense, type ReactNode } from 'react';
import { ConfigProvider, App as AntApp, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import AppLayout from './layouts/AppLayout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Applications = lazy(() => import('./pages/Applications'));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail'));
const Companies = lazy(() => import('./pages/Companies'));
const Today = lazy(() => import('./pages/Today'));
const Sources = lazy(() => import('./pages/Sources'));
const EmailAnalysis = lazy(() => import('./pages/EmailAnalysis'));
const Settings = lazy(() => import('./pages/Settings'));
const Resumes = lazy(() => import('./pages/Resumes'));
const Recommendations = lazy(() => import('./pages/Recommendations'));

dayjs.locale('zh-cn');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-live="polite"
          style={{ minHeight: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
        >
          <Spin size="large" />
          <span>页面加载中…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<LazyPage><Dashboard /></LazyPage>} />
                <Route path="/applications" element={<LazyPage><Applications /></LazyPage>} />
                <Route path="/applications/:id" element={<LazyPage><ApplicationDetail /></LazyPage>} />
                <Route path="/companies" element={<LazyPage><Companies /></LazyPage>} />
                <Route path="/today" element={<LazyPage><Today /></LazyPage>} />
                <Route path="/sources" element={<LazyPage><Sources /></LazyPage>} />
                <Route path="/email" element={<LazyPage><EmailAnalysis /></LazyPage>} />
                <Route path="/settings" element={<LazyPage><Settings /></LazyPage>} />
                <Route path="/resumes" element={<LazyPage><Resumes /></LazyPage>} />
                <Route path="/recommendations" element={<LazyPage><Recommendations /></LazyPage>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
