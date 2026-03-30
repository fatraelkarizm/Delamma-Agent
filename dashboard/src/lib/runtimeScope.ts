import { prisma } from "@/lib/db";

export type DashboardScope = {
  tenantId: string | null;
  walletId: string | null;
};

export function getScopeFromSearchParams(searchParams: URLSearchParams): DashboardScope {
  return {
    tenantId: searchParams.get("tenant_id")?.trim() || process.env.DASHBOARD_TENANT_ID?.trim() || null,
    walletId: searchParams.get("wallet_id")?.trim() || process.env.DASHBOARD_WALLET_ID?.trim() || null,
  };
}

export function buildScopeQuery(scope: DashboardScope) {
  const params = new URLSearchParams();
  if (scope.tenantId) params.set("tenant_id", scope.tenantId);
  if (scope.walletId) params.set("wallet_id", scope.walletId);
  return params.toString();
}

export async function resolveManagedWalletId(scope: DashboardScope) {
  if (!scope.walletId) return null;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM managed_wallets WHERE public_key = $1 LIMIT 1`,
      scope.walletId,
    );

    return rows?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
