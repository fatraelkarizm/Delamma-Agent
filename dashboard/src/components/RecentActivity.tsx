"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Clock, ArrowRight, TrendingUp, TrendingDown, Repeat2, DollarSign } from 'lucide-react';
import styles from './RecentActivity.module.css';

const ACTION_ICONS: Record<string, any> = {
  deploy:    <ArrowRight size={14} />,
  close:     <TrendingUp size={14} />,
  claim:     <DollarSign size={14} />,
  rebalance: <Repeat2 size={14} />,
};

const ACTION_COLORS: Record<string, string> = {
  deploy:    '#3b82f6',
  close:     '#22c55e',
  claim:     '#f59e0b',
  rebalance: '#8b5cf6',
};

export default function RecentActivity({ trades }: { trades: any[] }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Recent Activity</h3>
        <span className={styles.count}>{trades.length} events</span>
      </div>

      <div className={styles.list}>
        {trades.length === 0 ? (
          <div className={styles.empty}>
            <Clock size={32} className={styles.emptyIcon} />
            <p>No trade events yet.</p>
            <p className={styles.emptyHint}>Events appear here when the bot deploys, claims, or closes positions.</p>
          </div>
        ) : (
          trades.map((t: any, i: number) => {
            const icon  = ACTION_ICONS[t.action] || <Clock size={14} />;
            const color = ACTION_COLORS[t.action] || '#64748b';
            const time  = new Date(t.ts).toLocaleString('id-ID', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const isPositive = (t.pnl_usd ?? 0) >= 0;

            return (
              <div key={i} className={styles.item}>
                <div className={styles.iconWrap} style={{ backgroundColor: `${color}15`, color }}>
                  {icon}
                </div>
                <div className={styles.info}>
                  <div className={styles.actionRow}>
                    <span className={styles.action} style={{ color }}>{t.action?.toUpperCase()}</span>
                    <span className={styles.pool}>{t.pool_name || (t.pool || '').substring(0, 8) + '…'}</span>
                  </div>
                  <div className={styles.details}>
                    {t.fees_usd != null && <span>+${t.fees_usd.toFixed(2)} fees</span>}
                    {t.pnl_usd  != null && (
                      <span className={isPositive ? styles.positive : styles.negative}>
                        {isPositive ? '+' : ''}${t.pnl_usd.toFixed(2)} PnL
                      </span>
                    )}
                    {t.amount_sol != null && <span>{t.amount_sol} SOL</span>}
                  </div>
                </div>
                <span className={styles.time}>{time}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
