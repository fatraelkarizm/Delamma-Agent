import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getScopeFromSearchParams } from "@/lib/runtimeScope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_COMMANDS = new Set([
  "launch_worker",
  "restart_worker",
  "start_cron",
  "restart_cron",
  "stop_cron",
  "shutdown_worker",
  "run_management_cycle",
  "run_screening_cycle",
  "run_briefing",
]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = getScopeFromSearchParams(searchParams);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 10)));
    const where = [];
    const params: Array<string | number> = [];

    if (scope.tenantId) {
      params.push(scope.tenantId);
      where.push(`tenant_id = $${params.length}`);
    }

    if (scope.walletId) {
      params.push(scope.walletId);
      where.push(`wallet_id = $${params.length}`);
    }

    params.push(limit);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, tenant_id, wallet_id, worker_id, requested_by, command, payload, status, result, error, created_at, claimed_at, completed_at
       FROM worker_control_requests
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      ...params,
    ).catch(() => []);

    return NextResponse.json({ requests: rows, count: rows.length });
  } catch (err: any) {
    return NextResponse.json({ requests: [], count: 0, error: err.message }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body?.tenant_id || "").trim();
    const walletId = String(body?.wallet_id || "").trim();
    const command = String(body?.command || "").trim();
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
    const requestedBy = String(body?.requested_by || "dashboard").trim();

    if (!tenantId || !walletId) {
      return NextResponse.json({ error: "tenant_id and wallet_id are required" }, { status: 400 });
    }

    if (!ALLOWED_COMMANDS.has(command)) {
      return NextResponse.json({ error: `Unsupported command: ${command}` }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO worker_control_requests (
        tenant_id, wallet_id, requested_by, command, payload, status, created_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,'pending',NOW())
      RETURNING id, tenant_id, wallet_id, requested_by, command, payload, status, created_at`,
      tenantId,
      walletId,
      requestedBy,
      command,
      JSON.stringify(payload),
    );

    return NextResponse.json({ request: rows?.[0] || null, queued: Boolean(rows?.[0]) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
