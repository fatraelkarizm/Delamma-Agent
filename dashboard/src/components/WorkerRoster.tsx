/* eslint-disable @typescript-eslint/no-explicit-any */
import styles from "./WorkerRoster.module.css";

function formatTs(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString("id-ID", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function badgeClass(status: string | null | undefined) {
  switch (status) {
    case "completed":
      return styles.badgeDone;
    case "failed":
      return styles.badgeFailed;
    case "claimed":
      return styles.badgeClaimed;
    default:
      return styles.badgePending;
  }
}

export default function WorkerRoster({ runtimeState }: { runtimeState: any }) {
  const workers = runtimeState?.workers || [];
  const leases = runtimeState?.leases || [];
  const requests = runtimeState?.requests || [];
  const events = runtimeState?.events || [];

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Control Plane</p>
          <h3 className={styles.title}>Worker Roster</h3>
        </div>
        <div className={styles.summary}>
          <span>{workers.length} workers</span>
          <span>{leases.length} leases</span>
          <span>{requests.length} requests</span>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h4>Workers</h4>
            <span>{workers.length}</span>
          </div>
          <div className={styles.list}>
            {workers.length === 0 ? (
              <p className={styles.empty}>No workers visible for this scope.</p>
            ) : (
              workers.map((worker: any) => (
                <div key={worker.worker_id} className={styles.item}>
                  <div>
                    <p className={styles.primary}>{worker.worker_id}</p>
                    <p className={styles.secondary}>
                      {worker.tenant_id}/{worker.wallet_id} | {worker.mode || "n/a"} | {worker.channel || "n/a"}
                    </p>
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.statusPill}>{worker.status || "unknown"}</span>
                    <span className={styles.time}>seen {formatTs(worker.last_seen_at)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h4>Wallet Leases</h4>
            <span>{leases.length}</span>
          </div>
          <div className={styles.list}>
            {leases.length === 0 ? (
              <p className={styles.empty}>No active wallet lease visible.</p>
            ) : (
              leases.map((lease: any, index: number) => (
                <div key={`${lease.worker_id}-${index}`} className={styles.item}>
                  <div>
                    <p className={styles.primary}>{lease.worker_id}</p>
                    <p className={styles.secondary}>{lease.tenant_id}/{lease.wallet_id}</p>
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.time}>expires {formatTs(lease.expires_at)}</span>
                    <span className={styles.time}>renewed {formatTs(lease.renewed_at)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h4>Recent Control Requests</h4>
          <span>{requests.length}</span>
        </div>
        <div className={styles.list}>
          {requests.length === 0 ? (
            <p className={styles.empty}>No control requests recorded yet.</p>
          ) : (
            requests.map((request: any) => (
              <div key={String(request.id)} className={styles.item}>
                <div>
                  <p className={styles.primary}>{request.command}</p>
                  <p className={styles.secondary}>
                    {request.tenant_id}/{request.wallet_id} | by {request.requested_by || "unknown"} | created {formatTs(request.created_at)}
                  </p>
                </div>
                <div className={styles.meta}>
                  <span className={`${styles.requestBadge} ${badgeClass(request.status)}`}>{request.status}</span>
                  <span className={styles.time}>
                    {request.completed_at ? `done ${formatTs(request.completed_at)}` : request.claimed_at ? `claimed ${formatTs(request.claimed_at)}` : "pending"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h4>Worker Events</h4>
          <span>{events.length}</span>
        </div>
        <div className={styles.list}>
          {events.length === 0 ? (
            <p className={styles.empty}>No worker events recorded yet.</p>
          ) : (
            events.map((event: any) => (
              <div key={String(event.id)} className={styles.item}>
                <div>
                  <p className={styles.primary}>{event.event_type}</p>
                  <p className={styles.secondary}>{event.message}</p>
                </div>
                <div className={styles.meta}>
                  <span className={`${styles.requestBadge} ${badgeClass(event.level === "error" ? "failed" : event.level === "warn" ? "pending" : "completed")}`}>
                    {event.level || "info"}
                  </span>
                  <span className={styles.time}>{formatTs(event.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
