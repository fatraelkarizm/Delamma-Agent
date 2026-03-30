import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ScopeRow = {
  tenant_id: string;
  wallet_id: string;
  last_seen_at: Date;
  source: string;
};

export async function GET() {
  try {
    const snapshotRows = await prisma.$queryRawUnsafe<ScopeRow[]>(
      `SELECT tenant_id, wallet_id, MAX(updated_at) AS last_seen_at, 'snapshot' AS source
       FROM wallet_storage_snapshots
       GROUP BY tenant_id, wallet_id`
    ).catch(() => []);

    const workerRows = await prisma.$queryRawUnsafe<ScopeRow[]>(
      `SELECT tenant_id, wallet_id, MAX(last_seen_at) AS last_seen_at, 'worker' AS source
       FROM worker_processes
       GROUP BY tenant_id, wallet_id`
    ).catch(() => []);

    const merged = new Map<string, ScopeRow>();
    for (const row of [...snapshotRows, ...workerRows]) {
      const key = `${row.tenant_id}::${row.wallet_id}`;
      const existing = merged.get(key);
      if (!existing || new Date(row.last_seen_at).getTime() > new Date(existing.last_seen_at).getTime()) {
        merged.set(key, row);
      }
    }

    const scopes = [...merged.values()]
      .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime())
      .map((row) => ({
        tenant_id: row.tenant_id,
        wallet_id: row.wallet_id,
        last_seen_at: row.last_seen_at,
        source: row.source,
      }));

    return NextResponse.json({ scopes, count: scopes.length });
  } catch (err: any) {
    return NextResponse.json({ scopes: [], count: 0, error: err.message }, { status: 200 });
  }
}
