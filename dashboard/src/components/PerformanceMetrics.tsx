"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useTransition } from "react";
import { MoreHorizontal, CheckCircle, Clock, Play, RefreshCcw, Square, Radar, Shield } from "lucide-react";
import styles from "./PerformanceMetrics.module.css";

const CONTROL_ACTIONS = [
  { command: "start_cron", label: "Start", icon: Play },
  { command: "restart_cron", label: "Restart", icon: RefreshCcw },
  { command: "stop_cron", label: "Stop", icon: Square },
  { command: "run_management_cycle", label: "Manage", icon: Shield },
  { command: "run_screening_cycle", label: "Screen", icon: Radar },
];

export default function PerformanceMetrics({
  stats,
  botStatus,
  controlRequests = [],
  scope,
}: {
  stats: any;
  botStatus: any;
  controlRequests: any[];
  scope: { tenantId: string | null; walletId: string | null };
}) {
  const [requests, setRequests] = useState(controlRequests);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const winRate = stats?.win_rate_pct ?? 0;
  const totalClosed = stats?.total_closed ?? 0;
  const bestPnl = stats?.best_close_pnl ?? 0;
  const isLive = botStatus?.live ?? false;
  const isDryRun = botStatus?.dry_run ?? false;
  const lastSeen = botStatus?.last_seen ? new Date(botStatus.last_seen).toLocaleTimeString() : "Never";
  const minutesAgo = botStatus?.minutes_ago ?? null;
  const hasScope = Boolean(scope?.tenantId && scope?.walletId);

  const uptimePct = isLive ? 99 : Math.max(0, 100 - (minutesAgo ?? 100));

  function queueCommand(command: string) {
    if (!hasScope || isPending) return;

    startTransition(async () => {
      setFeedback(null);
      try {
        const res = await fetch("/api/control-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: scope.tenantId,
            wallet_id: scope.walletId,
            command,
            requested_by: "dashboard-ui",
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          setFeedback(json?.error || "Failed to queue control request");
          return;
        }

        if (json?.request) {
          setRequests((prev) => [json.request, ...prev].slice(0, 6));
        }
        setFeedback(`Queued ${command} for ${scope.tenantId}/${scope.walletId}`);
      } catch (error: any) {
        setFeedback(error?.message || "Failed to queue control request");
      }
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Performance</h3>
        <div className={styles.actions}>
          <button className={styles.moreBtn}><MoreHorizontal size={16} /></button>
        </div>
      </div>

      <div className={`${styles.botStatusCard} ${isLive ? styles.botLive : styles.botOffline}`}>
        <div className={styles.botStatusLeft}>
          <span className={`${styles.statusDot} ${isLive ? styles.dotGreen : styles.dotRed}`} />
          <span className={styles.botStatusLabel}>
            {isLive ? (isDryRun ? "DRY RUN Mode" : "Bot LIVE") : "Bot Offline"}
          </span>
        </div>
        <span className={styles.botStatusTime}>
          {isLive ? "Active" : `Last: ${lastSeen}`}
        </span>
      </div>

      <div className={styles.metricsList}>
        <MetricItem label="Win Rate" subLabel={`${totalClosed} closed trades`} value={`${winRate}%`} percent={winRate} color="#22c55e" />
        <MetricItem label="Bot Uptime" subLabel={isLive ? "Running" : `Offline ${minutesAgo ?? "?"}m`} value={`${Math.round(uptimePct)}%`} percent={uptimePct} color="#3b82f6" />
        <MetricItem label="Best Trade" subLabel="All time" value={`$${bestPnl.toFixed(2)}`} percent={Math.min(100, (bestPnl / Math.max(bestPnl, 1)) * 100)} color="#f59e0b" />
      </div>

      <div className={styles.controlPanel}>
        <div className={styles.controlHeader}>
          <div>
            <p className={styles.controlEyebrow}>Worker Control</p>
            <p className={styles.controlScope}>
              {hasScope ? `${scope.tenantId} / ${scope.walletId}` : "Pick a runtime scope first"}
            </p>
          </div>
          {isPending ? <span className={styles.pendingPill}>Queueing...</span> : null}
        </div>

        <div className={styles.controlButtons}>
          {CONTROL_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.command}
                className={styles.controlButton}
                onClick={() => queueCommand(action.command)}
                disabled={!hasScope || isPending}
              >
                <Icon size={15} />
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>

        <button
          className={styles.briefingButton}
          onClick={() => queueCommand("run_briefing")}
          disabled={!hasScope || isPending}
        >
          Queue Briefing
        </button>

        <p className={styles.controlHint}>
          Requests are picked up by the active worker for this scope. If no worker is online, requests stay pending.
        </p>

        {feedback ? <div className={styles.feedback}>{feedback}</div> : null}

        <div className={styles.requestList}>
          {requests.length === 0 ? (
            <p className={styles.emptyRequests}>No control requests queued yet.</p>
          ) : (
            requests.map((request) => (
              <div key={String(request.id)} className={styles.requestItem}>
                <div>
                  <p className={styles.requestCommand}>{request.command}</p>
                  <p className={styles.requestMeta}>
                    {request.requested_by || "unknown"} · {request.status}
                  </p>
                </div>
                <span className={`${styles.requestBadge} ${badgeClass(request.status)}`}>
                  {request.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={`${styles.footerAlert} ${isLive ? styles.alertGreen : styles.alertGray}`}>
        {isLive
          ? <><CheckCircle size={14} /> <span>Bot running - cycles active</span></>
          : <><Clock size={14} /> <span>Bot is offline. Start the bot to resume trading.</span></>
        }
      </div>
    </div>
  );
}

function badgeClass(status: string) {
  if (status === "completed") return styles.requestDone;
  if (status === "failed") return styles.requestFailed;
  if (status === "claimed") return styles.requestClaimed;
  return styles.requestPending;
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
