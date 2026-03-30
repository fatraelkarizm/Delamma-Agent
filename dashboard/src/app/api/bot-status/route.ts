/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getScopeFromSearchParams } from "@/lib/runtimeScope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = getScopeFromSearchParams(searchParams);

    if (scope.tenantId && scope.walletId) {
      const workerRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT worker_id, status, last_seen_at, lease_expires_at
         FROM worker_processes
         WHERE tenant_id = $1 AND wallet_id = $2
         ORDER BY last_seen_at DESC
         LIMIT 1`,
        scope.tenantId,
        scope.walletId,
      ).catch(() => []);

      const leaseRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT worker_id, expires_at
         FROM wallet_leases
         WHERE tenant_id = $1 AND wallet_id = $2
         ORDER BY renewed_at DESC
         LIMIT 1`,
        scope.tenantId,
        scope.walletId,
      ).catch(() => []);

      const worker = workerRows?.[0] || null;
      const lease = leaseRows?.[0] || null;

      if (worker) {
        const msSinceLastSeen = Date.now() - new Date(worker.last_seen_at).getTime();
        return NextResponse.json({
          live: msSinceLastSeen < OFFLINE_THRESHOLD_MS,
          last_seen: worker.last_seen_at,
          dry_run: false,
          open_positions: 0,
          minutes_ago: Math.floor(msSinceLastSeen / 60000),
          worker_id: worker.worker_id,
          status: worker.status,
          lease_expires_at: lease?.expires_at || worker.lease_expires_at || null,
          scoped: true,
        });
      }

      return NextResponse.json({
        live: false,
        last_seen: null,
        dry_run: false,
        open_positions: 0,
        minutes_ago: null,
        scoped: true,
      });
    }

    const status = await prisma.botStatus.findUnique({ where: { id: 1 } });

    if (!status) {
      return NextResponse.json({ live: false, last_seen: null, dry_run: false, open_positions: 0 });
    }

    const msSinceLastSeen = Date.now() - new Date(status.last_seen).getTime();
    const live = msSinceLastSeen < OFFLINE_THRESHOLD_MS;

    return NextResponse.json({
      live,
      last_seen:      status.last_seen,
      dry_run:        status.dry_run,
      open_positions: status.open_positions,
      minutes_ago:    Math.floor(msSinceLastSeen / 60000),
    });
  } catch (err: any) {
    return NextResponse.json({ live: false, error: err.message }, { status: 200 });
  }
}
