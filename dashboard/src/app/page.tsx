import SummaryCards from "@/components/SummaryCards";
import YieldChart from "@/components/YieldChart";
import PerformanceMetrics from "@/components/PerformanceMetrics";
import PositionsTable from "@/components/PositionsTable";
import RecentActivity from "@/components/RecentActivity";
import WorkerRoster from "@/components/WorkerRoster";
import { buildScopeQuery } from "@/lib/runtimeScope";
import styles from "./page.module.css";

const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

async function fetchData(path: string, scopeQuery = "") {
  try {
    const target = scopeQuery
      ? `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}${scopeQuery}`
      : `${BASE_URL}${path}`;
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Dashboard({ searchParams }: DashboardPageProps) {
  const resolvedParams = (await searchParams) || {};
  const tenantId = typeof resolvedParams.tenant_id === "string" ? resolvedParams.tenant_id : null;
  const walletId = typeof resolvedParams.wallet_id === "string" ? resolvedParams.wallet_id : null;
  const scope = { tenantId, walletId };
  const scopeQuery = buildScopeQuery(scope);

  const [stats, positions, wallet, botStatus, chartData, trades, scopeData] = await Promise.all([
    fetchData("/api/stats", scopeQuery),
    fetchData("/api/positions", scopeQuery),
    fetchData("/api/wallet", scopeQuery),
    fetchData("/api/bot-status", scopeQuery),
    fetchData("/api/chart-data?period=monthly", scopeQuery),
    fetchData("/api/trades?limit=10", scopeQuery),
    fetchData("/api/scopes"),
  ]);
  const [controlRequests, runtimeState] = await Promise.all([
    fetchData("/api/control-requests?limit=6", scopeQuery),
    fetchData("/api/runtime-state?worker_limit=8&request_limit=12", scopeQuery),
  ]);

  const scopes = scopeData?.scopes || [];
  const currentScopeLabel = tenantId && walletId
    ? `${tenantId} / ${walletId}`
    : "Latest runtime scope";

  return (
    <div className={styles.dashboardContainer}>
      <section className={styles.scopeBar}>
        <div>
          <p className={styles.scopeEyebrow}>Runtime Scope</p>
          <h2 className={styles.scopeTitle}>{currentScopeLabel}</h2>
          <p className={styles.scopeHint}>
            Dashboard routes now honor explicit tenant and wallet scope when snapshots or worker runtime data exist.
          </p>
        </div>

        <div className={styles.scopeLinks}>
          <a href="/" className={!tenantId && !walletId ? styles.scopeLinkActive : styles.scopeLink}>
            Latest
          </a>
          {scopes.slice(0, 8).map((item: any) => {
            const href = `/?${buildScopeQuery({ tenantId: item.tenant_id, walletId: item.wallet_id })}`;
            const isActive = item.tenant_id === tenantId && item.wallet_id === walletId;
            return (
              <a key={`${item.tenant_id}:${item.wallet_id}`} href={href} className={isActive ? styles.scopeLinkActive : styles.scopeLink}>
                {item.tenant_id} / {item.wallet_id}
              </a>
            );
          })}
        </div>
      </section>

      <SummaryCards stats={stats} wallet={wallet} />

      <div className={styles.middleRow}>
        <div className={styles.chartSection}>
          <YieldChart chartData={chartData} />
        </div>
        <div className={styles.metricsSection}>
          <PerformanceMetrics
            stats={stats}
            botStatus={botStatus}
            controlRequests={controlRequests?.requests || []}
            scope={scope}
          />
        </div>
      </div>

      <div className={styles.runtimeRow}>
        <WorkerRoster runtimeState={runtimeState} />
      </div>

      <div className={styles.bottomRow}>
        <div className={styles.tableSection}>
          <PositionsTable positions={positions?.positions || []} />
        </div>
        <div className={styles.activitySection}>
          <RecentActivity trades={trades?.trades || []} />
        </div>
      </div>
    </div>
  );
}
