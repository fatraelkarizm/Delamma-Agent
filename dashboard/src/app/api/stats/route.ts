/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getScopeFromSearchParams, resolveManagedWalletId } from "@/lib/runtimeScope";
import { getLatestStoreSnapshot, readLegacyStoreFile } from "@/lib/storageSnapshots";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = getScopeFromSearchParams(searchParams);
    const managedWalletId = await resolveManagedWalletId(scope);
    const dbScopeFilter: any = managedWalletId ? { wallet: { is: { id: managedWalletId } } } : undefined;
    const scopeRequiresDbFilter = Boolean(scope.walletId);
    const canUseDbScope = !scopeRequiresDbFilter || Boolean(managedWalletId);

    // Total fees/PNL from all closed positions
    const totalFeesAgg = canUseDbScope
      ? await prisma.tradeEvent.aggregate({
          where: dbScopeFilter,
          _sum: { fees_usd: true, pnl_usd: true },
        })
      : { _sum: { fees_usd: 0, pnl_usd: 0 } };

    // Today's trades
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEvents = canUseDbScope
      ? await prisma.tradeEvent.findMany({
          where: { ...(dbScopeFilter || {}), ts: { gte: today } },
        })
      : [];

    // Win rate (closed trades with pnl > 0)
    const closedTrades = canUseDbScope
      ? await prisma.tradeEvent.findMany({
          where: { ...(dbScopeFilter || {}), action: "close" },
          select: { pnl_usd: true },
        })
      : [];
    const wins   = closedTrades.filter((t: any) => (t.pnl_usd ?? 0) > 0).length;
    const total  = closedTrades.length;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

    // Open positions count from latest runtime snapshot, fallback to legacy file, then DB
    let openPositions = 0;
    try {
      const scopedSnapshot = await getLatestStoreSnapshot("state", scope);
      const raw: any = scopedSnapshot?.content || readLegacyStoreFile("state.json");
      if (raw && typeof raw === "object") {
        openPositions = Object.values(raw.positions || {}).filter((p: any) => !p.closed).length;
      } else {
        openPositions = canUseDbScope
          ? await prisma.position.count({ where: { closed: false, ...(dbScopeFilter || {}) } })
          : 0;
      }
    } catch {
      openPositions = canUseDbScope
        ? await prisma.position.count({ where: { closed: false, ...(dbScopeFilter || {}) } })
        : 0;
    }

    // Rebalance count
    const rebalances = canUseDbScope
      ? await prisma.tradeEvent.count({ where: { ...(dbScopeFilter || {}), action: "rebalance" } })
      : 0;

    // Best + worst performing close
    const bestClose = canUseDbScope
      ? await prisma.tradeEvent.findFirst({
          where: { ...(dbScopeFilter || {}), action: "close" },
          orderBy: { pnl_usd: "desc" },
        })
      : null;
    const worstClose = canUseDbScope
      ? await prisma.tradeEvent.findFirst({
          where: { ...(dbScopeFilter || {}), action: "close" },
          orderBy: { pnl_usd: "asc" },
        })
      : null;

    // 24h volume approx (initial_value_usd of deploys today)
    const volume24hAgg = canUseDbScope
      ? await prisma.tradeEvent.aggregate({
          where: { ...(dbScopeFilter || {}), action: "deploy", ts: { gte: today } },
          _sum: { amount_sol: true },
        })
      : { _sum: { amount_sol: 0 } };

    return NextResponse.json({
      total_fees_usd:     Math.round((totalFeesAgg._sum?.fees_usd ?? 0) * 100) / 100,
      total_pnl_usd:      Math.round((totalFeesAgg._sum?.pnl_usd ?? 0) * 100) / 100,
      today_trades:       todayEvents.length,
      today_fees_usd:     Math.round(todayEvents.reduce((s: number, t: any) => s + (t.fees_usd ?? 0), 0) * 100) / 100,
      today_pnl_usd:      Math.round(todayEvents.reduce((s: number, t: any) => s + (t.pnl_usd ?? 0), 0) * 100) / 100,
      open_positions:     openPositions,
      total_rebalances:   rebalances,
      win_rate_pct:       winRate,
      total_closed:       total,
      best_close_pnl:     bestClose?.pnl_usd ?? 0,
      worst_close_pnl:    worstClose?.pnl_usd ?? 0,
      volume_24h_sol:     Math.round((volume24hAgg._sum?.amount_sol ?? 0) * 1000) / 1000,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
