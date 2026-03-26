/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit  = parseInt(searchParams.get("limit") || "20");
    const action = searchParams.get("action"); // filter by action type

    const events = await prisma.tradeEvent.findMany({
      where:   action ? { action } : undefined,
      orderBy: { ts: "desc" },
      take:    limit,
    });

    return NextResponse.json({ trades: events, count: events.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
