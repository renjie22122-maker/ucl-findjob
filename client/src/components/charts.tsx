import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, FunnelChart as EChartsFunnel } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { OverviewStats, TrendPoint } from '../types';
import { STATUS_COLORS, STATUS_LABELS, ALL_STATUSES } from '../utils/constants';
import type { AppStatus } from '../types';

echarts.use([BarChart, LineChart, PieChart, EChartsFunnel, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

function useChart(option: EChartsCoreOption) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [option]);
  return ref;
}

export function TrendChart({ trends }: { trends: TrendPoint[] }) {
  const ref = useChart({
    tooltip: { trigger: 'axis' },
    legend: { data: ['投递', '笔试/面试', 'Offer', '被拒'] },
    grid: { left: 40, right: 16, top: 40, bottom: 28 },
    xAxis: { type: 'category', data: trends.map((t) => t.date.slice(5)) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: '投递', type: 'line', smooth: true, data: trends.map((t) => t.applied), color: '#1677ff' },
      { name: '笔试/面试', type: 'line', smooth: true, data: trends.map((t) => t.interviewed), color: '#9254de' },
      { name: 'Offer', type: 'line', smooth: true, data: trends.map((t) => t.offer), color: '#faad14' },
      { name: '被拒', type: 'line', smooth: true, data: trends.map((t) => t.rejected), color: '#ff4d4f' },
    ],
  });
  return <div ref={ref} style={{ width: '100%', height: 300 }} />;
}

export function FunnelChart({ stats }: { stats: OverviewStats }) {
  const ref = useChart({
    tooltip: {},
    series: [
      {
        type: 'funnel',
        left: 40,
        width: '70%',
        label: { formatter: '{b}：{c}' },
        data: [
          { value: stats.funnel.applied, name: '已投递' },
          { value: stats.funnel.interviewed, name: '进入笔试/面试' },
          { value: stats.funnel.offer, name: '拿到 Offer' },
        ],
      },
    ],
  });
  return <div ref={ref} style={{ width: '100%', height: 260 }} />;
}

const PIE_COLORS: Record<string, string> = {
  default: '#bfbfbf',
  blue: '#1677ff',
  cyan: '#13c2c2',
  geekblue: '#2f54eb',
  purple: '#722ed1',
  magenta: '#eb2f96',
  gold: '#faad14',
  green: '#52c41a',
  red: '#ff4d4f',
};

export function StatusPieChart({ stats }: { stats: OverviewStats }) {
  const data = ALL_STATUSES.filter((s) => (stats.byStatus[s] ?? 0) > 0).map((s) => ({
    name: STATUS_LABELS[s as AppStatus],
    value: stats.byStatus[s] ?? 0,
    itemStyle: { color: PIE_COLORS[STATUS_COLORS[s]] },
  }));
  const ref = useChart({
    tooltip: { trigger: 'item', formatter: '{b}：{c}（{d}%）' },
    legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle' },
    series: [{ type: 'pie', radius: ['35%', '65%'], center: ['38%', '50%'], data, label: { show: false } }],
  });
  return <div ref={ref} style={{ width: '100%', height: 260 }} />;
}
