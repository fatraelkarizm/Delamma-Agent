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

    let statePositions: any[] = [];
    try {
      const snapshot = await getLatestStoreSnapshot("state", scope);
      const raw: any = snapshot?.content || (!scope.tenantId && !scope.walletId ? readLegacyStoreFile("state.json") : null);
      if (raw && typeof raw === "object") {
        statePositions = Object.values(raw.positions || {});
      }
    } catch { /* fallback to DB */ }

    const dbPositions = scope.walletId && !managedWalletId
      ? []
      : await prisma.position.findMany({
          where: {
            closed: false,
            ...(managedWalletId ? ({ wallet: { is: { id: managedWalletId } } } as any) : {}),
          },
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
