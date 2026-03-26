/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export async function GET() {
  try {
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
