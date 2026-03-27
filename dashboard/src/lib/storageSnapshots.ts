import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";

type SnapshotRow = {
  tenant_id: string;
  wallet_id: string;
  store_key: string;
  content: unknown;
  metadata: unknown;
  updated_at: Date;
};

export async function getLatestStoreSnapshot(
  storeKey: string,
  {
    tenantId = process.env.DASHBOARD_TENANT_ID?.trim() || null,
    walletId = process.env.DASHBOARD_WALLET_ID?.trim() || null,
  }: { tenantId?: string | null; walletId?: string | null } = {},
) {
  const where = ["store_key = $1"];
  const params: string[] = [storeKey];

  if (tenantId) {
    params.push(tenantId);
    where.push(`tenant_id = $${params.length}`);
  }

  if (walletId) {
    params.push(walletId);
    where.push(`wallet_id = $${params.length}`);
  }

  try {
    const rows = await prisma.$queryRawUnsafe<SnapshotRow[]>(
      `SELECT tenant_id, wallet_id, store_key, content, metadata, updated_at
       FROM wallet_storage_snapshots
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT 1`,
      ...params,
    );

    return rows?.[0] || null;
  } catch {
    return null;
  }
}

export function readLegacyStoreFile(fileName: string) {
  const candidates = [
    path.join(process.cwd(), "..", "data", fileName),
    path.join(process.cwd(), "..", fileName),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    } catch {
      continue;
    }
  }

  return null;
}
