"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MoreHorizontal } from 'lucide-react';
import styles from './YieldChart.module.css';

const MOCK_DATA = [
  { name: 'Jan', pnl: 0 }, { name: 'Feb', pnl: 0 }, { name: 'Mar', pnl: 0 },
  { name: 'Apr', pnl: 0 }, { name: 'May', pnl: 0 }, { name: 'Jun', pnl: 0 },
  { name: 'Jul', pnl: 0 }, { name: 'Aug', pnl: 0 }, { name: 'Sep', pnl: 0 },
  { name: 'Oct', pnl: 0 }, { name: 'Nov', pnl: 0 }, { name: 'Dec', pnl: 0 },
];

export default function YieldChart({ chartData }: { chartData: any }) {
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');

  const data   = chartData?.data?.length > 0 ? chartData.data : MOCK_DATA;
  const total  = chartData?.total_pnl ?? 0;
  const totalFees = chartData?.total_fees ?? 0;
  const maxVal = Math.max(...data.map((d: any) => Math.abs(d.pnl || 0)), 1);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Yield Summary</h3>
          <div className={styles.totalValue}>
            {total >= 0 ? '+' : ''}${Math.abs(total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            <span className={styles.feesLabel}>
              &nbsp;&nbsp;+${totalFees.toFixed(2)} fees
            </span>
          </div>
        </div>

        <div className={styles.actions}>
          <div className={styles.filters}>
            <button
              className={`${styles.filterBtn} ${period === 'monthly' ? styles.active : ''}`}
              onClick={() => setPeriod('monthly')}
            >Monthly</button>
            <button
              className={`${styles.filterBtn} ${period === 'weekly' ? styles.active : ''}`}
              onClick={() => setPeriod('weekly')}
            >Weekly</button>
          </div>
          <button className={styles.moreBtn}><MoreHorizontal size={16} /></button>
        </div>
      </div>

      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: 13 }}
              formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'PNL']}
            />
            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
              {data.map((entry: any, i: number) => (
                <Cell key={`cell-${i}`}
                  fill={entry.pnl >= 0
                    ? (entry.pnl >= maxVal * 0.6 ? '#22c55e' : '#86efac')
                    : '#fca5a5'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {data.every((d: any) => d.pnl === 0) && (
        <div className={styles.emptyState}>
          No trade data yet — PNL chart will populate as the bot executes trades.
        </div>
      )}
    </div>
  );
}
