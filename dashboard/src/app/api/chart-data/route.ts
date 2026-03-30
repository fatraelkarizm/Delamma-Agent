/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getScopeFromSearchParams, resolveManagedWalletId } from "@/lib/runtimeScope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = getScopeFromSearchParams(searchParams);
    const managedWalletId = await resolveManagedWalletId(scope);
    const period = searchParams.get("period") || "monthly"; // monthly | weekly

    let rows: any[] = [];
    if (scope.walletId && !managedWalletId) {
      return NextResponse.json({ data: [], total_pnl: 0, total_fees: 0 });
    }

    if (period === "monthly") {
      // Get last 12 months of daily_pnl rolled up by month
      rows = managedWalletId
        ? await prisma.$queryRaw`
        SELECT
          TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'Mon') AS name,
          DATE_TRUNC('month', TO_DATE(date, 'YYYY-MM-DD')) AS month_start,
          SUM(pnl_usd)  AS pnl_usd,
          SUM(fees_usd) AS fees_usd,
          SUM(trades)   AS trades
        FROM daily_pnl
        WHERE wallet_id = ${managedWalletId}
          AND TO_DATE(date, 'YYYY-MM-DD') >= NOW() - INTERVAL '12 months'
        GROUP BY name, month_start
        ORDER BY month_start
      `
        : await prisma.$queryRaw`
        SELECT
          TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'Mon') AS name,
          DATE_TRUNC('month', TO_DATE(date, 'YYYY-MM-DD')) AS month_start,
          SUM(pnl_usd)  AS pnl_usd,
          SUM(fees_usd) AS fees_usd,
          SUM(trades)   AS trades
        FROM daily_pnl
        WHERE TO_DATE(date, 'YYYY-MM-DD') >= NOW() - INTERVAL '12 months'
        GROUP BY name, month_start
        ORDER BY month_start
      `;
    } else {
      // Last 12 weeks
      rows = managedWalletId
        ? await prisma.$queryRaw`
        SELECT
          'W' || TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'IW') AS name,
          DATE_TRUNC('week', TO_DATE(date, 'YYYY-MM-DD')) AS week_start,
          SUM(pnl_usd)  AS pnl_usd,
          SUM(fees_usd) AS fees_usd,
          SUM(trades)   AS trades
        FROM daily_pnl
        WHERE wallet_id = ${managedWalletId}
          AND TO_DATE(date, 'YYYY-MM-DD') >= NOW() - INTERVAL '12 weeks'
        GROUP BY name, week_start
        ORDER BY week_start
      `
        : await prisma.$queryRaw`
        SELECT
          'W' || TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'IW') AS name,
          DATE_TRUNC('week', TO_DATE(date, 'YYYY-MM-DD')) AS week_start,
          SUM(pnl_usd)  AS pnl_usd,
          SUM(fees_usd) AS fees_usd,
          SUM(trades)   AS trades
        FROM daily_pnl
        WHERE TO_DATE(date, 'YYYY-MM-DD') >= NOW() - INTERVAL '12 weeks'
        GROUP BY name, week_start
        ORDER BY week_start
      `;
    }

    // Normalize for recharts
    const data = (rows as any[]).map((r) => ({
      name:     r.name,
      pnl:      Math.round(Number(r.pnl_usd) * 100) / 100,
      fees:     Math.round(Number(r.fees_usd) * 100) / 100,
      trades:   Number(r.trades),
    }));

    const totalPnl  = data.reduce((s, d) => s + d.pnl, 0);
    const totalFees = data.reduce((s, d) => s + d.fees, 0);

    return NextResponse.json({ data, total_pnl: totalPnl, total_fees: totalFees });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, data: [] }, { status: 200 });
  }
}
