"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowUpRight, ArrowDownRight, MoreHorizontal, Wallet, TrendingUp, Activity, RefreshCw } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import styles from './SummaryCards.module.css';

const mockSparkline1 = [{ v: 2 }, { v: 5 }, { v: 3 }, { v: 7 }, { v: 6 }, { v: 8 }];
const mockSparkline2 = [{ v: 8 }, { v: 6 }, { v: 7 }, { v: 3 }, { v: 5 }, { v: 2 }];

export default function SummaryCards({ stats, wallet }: { stats: any; wallet: any }) {
  const totalPnl       = stats?.total_pnl_usd    ?? 0;
  const todayPnl       = stats?.today_pnl_usd    ?? 0;
  const todayTrades    = stats?.today_trades      ?? 0;
  const openPositions  = stats?.open_positions    ?? 0;
  const solBalance     = wallet?.sol_balance      ?? 0;
  const solUsd         = wallet?.sol_usd          ?? 0;
  const rebalances     = stats?.total_rebalances  ?? 0;

  const isPnlPositive  = totalPnl >= 0;
  const isTodayPositive = todayPnl >= 0;

  return (
    <div className={styles.grid}>
      <Card
        icon={<TrendingUp size={18} />}
        title="Total PNL"
        value={`${isPnlPositive ? '+' : ''}$${Math.abs(totalPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        sub={`Today: ${isTodayPositive ? '+' : ''}$${Math.abs(todayPnl).toFixed(2)}`}
        isPositive={isPnlPositive}
        chartData={mockSparkline1}
        color={isPnlPositive ? '#22c55e' : '#ef4444'}
      />
      <Card
        icon={<Activity size={18} />}
        title="Active Positions"
        value={String(openPositions)}
        sub={`${todayTrades} trades today`}
        isPositive={true}
        chartData={mockSparkline1}
        color="#22c55e"
      />
      <Card
        icon={<Wallet size={18} />}
        title="Wallet Balance"
        value={`${solBalance} SOL`}
        sub={`≈ $${solUsd.toLocaleString()}`}
        isPositive={true}
        chartData={mockSparkline2}
        color="#3b82f6"
      />
      <Card
        icon={<RefreshCw size={18} />}
        title="Rebalances"
        value={String(rebalances)}
        sub={`Win rate: ${stats?.win_rate_pct ?? 0}%`}
        isPositive={true}
        chartData={mockSparkline1}
        color="#22c55e"
      />
    </div>
  );
}

function Card({ icon, title, value, sub, isPositive, chartData, color }: any) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.titleIcon} style={{ color }}>{icon}</span>
          <h3 className={styles.title}>{title}</h3>
        </div>
        <button className={styles.moreBtn}><MoreHorizontal size={16} /></button>
      </div>
      <div className={styles.content}>
        <div className={styles.info}>
          <div className={styles.value}>{value}</div>
          <div className={`${styles.badge} ${isPositive ? styles.positive : styles.negative}`}>
            {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            <span>{sub}</span>
          </div>
        </div>
        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`sc-grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} fill={`url(#sc-grad-${title})`} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
