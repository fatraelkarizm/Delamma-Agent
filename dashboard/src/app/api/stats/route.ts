/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // Total fees/PNL from all closed positions
    const totalFeesAgg = await prisma.tradeEvent.aggregate({
      _sum: { fees_usd: true, pnl_usd: true },
    });

    // Today's trades
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEvents = await prisma.tradeEvent.findMany({
      where: { ts: { gte: today } },
    });

    // Win rate (closed trades with pnl > 0)
    const closedTrades = await prisma.tradeEvent.findMany({
      where: { action: "close" },
      select: { pnl_usd: true },
    });
    const wins   = closedTrades.filter((t: any) => (t.pnl_usd ?? 0) > 0).length;
    const total  = closedTrades.length;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

    // Open positions count (authoritative from state.json, fallback to DB)
    let openPositions = 0;
    try {
      const fs = require("fs");
      const path = require("path");
      const statePath = path.join(process.cwd(), "..", "state.json");
      if (fs.existsSync(statePath)) {
        const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        openPositions = Object.values(raw.positions || {}).filter((p: any) => !p.closed).length;
      } else {
        openPositions = await prisma.position.count({ where: { closed: false } });
      }
    } catch {
      openPositions = await prisma.position.count({ where: { closed: false } });
    }

    // Rebalance count
    const rebalances = await prisma.tradeEvent.count({ where: { action: "rebalance" } });

    // Best + worst performing close
    const bestClose = await prisma.tradeEvent.findFirst({
      where: { action: "close" },
      orderBy: { pnl_usd: "desc" },
    });
    const worstClose = await prisma.tradeEvent.findFirst({
      where: { action: "close" },
      orderBy: { pnl_usd: "asc" },
    });

    // 24h volume approx (initial_value_usd of deploys today)
    const volume24hAgg = await prisma.tradeEvent.aggregate({
      where: { action: "deploy", ts: { gte: today } },
      _sum: { amount_sol: true },
    });

    return NextResponse.json({
      total_fees_usd:     Math.round((totalFeesAgg._sum.fees_usd ?? 0) * 100) / 100,
      total_pnl_usd:      Math.round((totalFeesAgg._sum.pnl_usd ?? 0) * 100) / 100,
      today_trades:       todayEvents.length,
      today_fees_usd:     Math.round(todayEvents.reduce((s: number, t: any) => s + (t.fees_usd ?? 0), 0) * 100) / 100,
      today_pnl_usd:      Math.round(todayEvents.reduce((s: number, t: any) => s + (t.pnl_usd ?? 0), 0) * 100) / 100,
      open_positions:     openPositions,
      total_rebalances:   rebalances,
      win_rate_pct:       winRate,
      total_closed:       total,
      best_close_pnl:     bestClose?.pnl_usd ?? 0,
      worst_close_pnl:    worstClose?.pnl_usd ?? 0,
      volume_24h_sol:     Math.round((volume24hAgg._sum.amount_sol ?? 0) * 1000) / 1000,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
