"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MoreHorizontal, CheckCircle, XCircle, Clock } from 'lucide-react';
import styles from './PerformanceMetrics.module.css';

export default function PerformanceMetrics({ stats, botStatus }: { stats: any; botStatus: any }) {
  const winRate      = stats?.win_rate_pct    ?? 0;
  const totalClosed  = stats?.total_closed    ?? 0;
  const bestPnl      = stats?.best_close_pnl  ?? 0;
  const isLive       = botStatus?.live        ?? false;
  const isDryRun     = botStatus?.dry_run     ?? false;
  const lastSeen     = botStatus?.last_seen   ? new Date(botStatus.last_seen).toLocaleTimeString() : 'Never';
  const minutesAgo   = botStatus?.minutes_ago ?? null;

  // Uptime: bot is considered "up" if last seen < 5min ago
  const uptimePct = isLive ? 99 : Math.max(0, 100 - (minutesAgo ?? 100));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Performance</h3>
        <div className={styles.actions}>
          <button className={styles.moreBtn}><MoreHorizontal size={16} /></button>
        </div>
      </div>

      {/* Bot Status */}
      <div className={`${styles.botStatusCard} ${isLive ? styles.botLive : styles.botOffline}`}>
        <div className={styles.botStatusLeft}>
          <span className={`${styles.statusDot} ${isLive ? styles.dotGreen : styles.dotRed}`} />
          <span className={styles.botStatusLabel}>
            {isLive ? (isDryRun ? 'DRY RUN Mode' : '🤖 Bot LIVE') : '😴 Bot Offline'}
          </span>
        </div>
        <span className={styles.botStatusTime}>
          {isLive ? `Active` : `Last: ${lastSeen}`}
        </span>
      </div>

      <div className={styles.metricsList}>
        <MetricItem label="Win Rate" subLabel={`${totalClosed} closed trades`} value={`${winRate}%`} percent={winRate} color="#22c55e" />
        <MetricItem label="Bot Uptime" subLabel={isLive ? 'Running' : `Offline ${minutesAgo ?? '?'}m`} value={`${Math.round(uptimePct)}%`} percent={uptimePct} color="#3b82f6" />
        <MetricItem label="Best Trade" subLabel="All time" value={`$${bestPnl.toFixed(2)}`} percent={Math.min(100, (bestPnl / Math.max(bestPnl, 1)) * 100)} color="#f59e0b" />
      </div>

      <div className={`${styles.footerAlert} ${isLive ? styles.alertGreen : styles.alertGray}`}>
        {isLive
          ? <><CheckCircle size={14} /> <span>Bot running — cycles active</span></>
          : <><Clock size={14} /> <span>Bot is offline. Start the bot to resume trading.</span></>
        }
      </div>
    </div>
  );
}

function MetricItem({ label, subLabel, value, percent, color }: any) {
  return (
    <div className={styles.metricItem}>
      <div className={styles.metricHeader}>
        <span className={styles.label}>{label}</span>
        <span className={styles.subLabel}>{subLabel}</span>
      </div>
      <div className={styles.progressArea}>
        <div className={styles.progressBarBg}>
          <div className={styles.progressBarFill} style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}>
            <div className={styles.progressHandle} />
          </div>
        </div>
        <span className={styles.metricValue}>{value}</span>
      </div>
    </div>
  );
}
