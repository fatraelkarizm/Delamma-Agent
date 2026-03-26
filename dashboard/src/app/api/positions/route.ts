/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // Read live positions from state.json first (authoritative for open positions)
    let statePositions: any[] = [];
    try {
      const statePath = path.join(process.cwd(), "..", "state.json");
      if (fs.existsSync(statePath)) {
        const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        statePositions = Object.values(raw.positions || {});
      }
    } catch { /* fallback to DB */ }

    // Merge with DB for extra metadata
    const dbPositions = await prisma.position.findMany({
      where: { closed: false },
      orderBy: { deployed_at: "desc" },
    });

    // Prefer state.json data, enrich with DB data where available
    const merged = statePositions.length > 0
      ? statePositions.map((sp: any) => {
          const dbMatch = dbPositions.find((dp: any) => dp.position === sp.position);
          return { ...sp, ...dbMatch, ...sp }; // state.json takes precedence
        })
      : dbPositions;

    return NextResponse.json({ positions: merged, count: merged.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
