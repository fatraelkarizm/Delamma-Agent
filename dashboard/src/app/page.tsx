/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import SummaryCards from '@/components/SummaryCards';
import YieldChart from '@/components/YieldChart';
import PerformanceMetrics from '@/components/PerformanceMetrics';
import PositionsTable from '@/components/PositionsTable';
import RecentActivity from '@/components/RecentActivity';
import styles from './page.module.css';

const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

async function fetchData(path: string) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export default async function Dashboard() {
  // Fetch all data in parallel from our API routes
  const [stats, positions, wallet, botStatus, chartData, trades] = await Promise.all([
    fetchData('/api/stats'),
    fetchData('/api/positions'),
    fetchData('/api/wallet'),
    fetchData('/api/bot-status'),
    fetchData('/api/chart-data?period=monthly'),
    fetchData('/api/trades?limit=10'),
  ]);

  // Also read state.json for additional context
  let stateData: any = {};
  try {
    const statePath = path.join(process.cwd(), '..', 'state.json');
    if (fs.existsSync(statePath)) {
      stateData = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    }
  } catch { /* ignore */ }

  return (
    <div className={styles.dashboardContainer}>
      <SummaryCards stats={stats} wallet={wallet} />

      <div className={styles.middleRow}>
        <div className={styles.chartSection}>
          <YieldChart chartData={chartData} />
        </div>
        <div className={styles.metricsSection}>
          <PerformanceMetrics stats={stats} botStatus={botStatus} />
        </div>
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
