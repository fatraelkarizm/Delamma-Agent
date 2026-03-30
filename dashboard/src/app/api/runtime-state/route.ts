import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getScopeFromSearchParams } from "@/lib/runtimeScope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = getScopeFromSearchParams(searchParams);
    const workerLimit = Math.min(20, Math.max(1, Number(searchParams.get("worker_limit") || 10)));
    const requestLimit = Math.min(30, Math.max(1, Number(searchParams.get("request_limit") || 12)));
    const eventLimit = Math.min(30, Math.max(1, Number(searchParams.get("event_limit") || 12)));

    const scopeWhere = [];
    const scopeParams: Array<string | number> = [];

    if (scope.tenantId) {
      scopeParams.push(scope.tenantId);
      scopeWhere.push(`tenant_id = $${scopeParams.length}`);
    }

    if (scope.walletId) {
      scopeParams.push(scope.walletId);
      scopeWhere.push(`wallet_id = $${scopeParams.length}`);
    }

    const workerParams = [...scopeParams, workerLimit];
    const requestParams = [...scopeParams, requestLimit];
    const eventParams = [...scopeParams, eventLimit];

    const workers = await prisma.$queryRawUnsafe<any[]>(
      `SELECT worker_id, tenant_id, wallet_id, mode, channel, status, metadata, registered_at, last_seen_at, lease_expires_at
       FROM worker_processes
       ${scopeWhere.length ? `WHERE ${scopeWhere.join(" AND ")}` : ""}
       ORDER BY last_seen_at DESC
       LIMIT $${workerParams.length}`,
      ...workerParams,
    ).catch(() => []);

    const leases = await prisma.$queryRawUnsafe<any[]>(
      `SELECT tenant_id, wallet_id, worker_id, acquired_at, renewed_at, expires_at, metadata
       FROM wallet_leases
       ${scopeWhere.length ? `WHERE ${scopeWhere.join(" AND ")}` : ""}
       ORDER BY renewed_at DESC`,
      ...scopeParams,
    ).catch(() => []);

    const requests = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, tenant_id, wallet_id, worker_id, requested_by, command, status, error, created_at, claimed_at, completed_at
       FROM worker_control_requests
       ${scopeWhere.length ? `WHERE ${scopeWhere.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT $${requestParams.length}`,
      ...requestParams,
    ).catch(() => []);

    const events = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, tenant_id, wallet_id, worker_id, level, event_type, message, payload, created_at
       FROM worker_activity_events
       ${scopeWhere.length ? `WHERE ${scopeWhere.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT $${eventParams.length}`,
      ...eventParams,
    ).catch(() => []);

    return NextResponse.json({
      scope,
      workers,
      leases,
      requests,
      events,
    });
  } catch (err: any) {
    return NextResponse.json({ workers: [], leases: [], requests: [], events: [], error: err.message }, { status: 200 });
  }
}
