import fs from "fs";
import path from "path";
import { DATA_DIR, walletDataDir } from "../lib/paths.js";
import {
  getWalletStorageSnapshot,
  listWalletStorageScopes,
  upsertWalletStorageSnapshot,
} from "../lib/db.js";

const SNAPSHOT_FILE_MAP = [
  { storeKey: "state", fileName: "state.json" },
  { storeKey: "pool-memory", fileName: "pool-memory.json" },
  { storeKey: "lessons", fileName: "lessons.json" },
  { storeKey: "strategy-library", fileName: "strategy-library.json" },
  { storeKey: "smart-wallets", fileName: "smart-wallets.json" },
  { storeKey: "token-blacklist", fileName: "token-blacklist.json" },
];

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function discoverWalletScopes() {
  const tenantRoot = path.join(DATA_DIR, "tenants");
  if (!fs.existsSync(tenantRoot)) return [];

  const scopes = [];
  for (const tenantEntry of fs.readdirSync(tenantRoot, { withFileTypes: true })) {
    if (!tenantEntry.isDirectory()) continue;
    const walletsRoot = path.join(tenantRoot, tenantEntry.name, "wallets");
    if (!fs.existsSync(walletsRoot)) continue;

    for (const walletEntry of fs.readdirSync(walletsRoot, { withFileTypes: true })) {
      if (!walletEntry.isDirectory()) continue;
      scopes.push({
        tenantId: tenantEntry.name,
        walletId: walletEntry.name,
        dir: path.join(walletsRoot, walletEntry.name),
        source: "wallet-data-dir",
      });
    }
  }

  return scopes;
}

function discoverLocalScope() {
  return {
    tenantId: "local",
    walletId: process.env.WALLET_ADDRESS || "primary",
    dir: DATA_DIR,
    source: "legacy-local-data",
  };
}

export async function bootstrapWalletStorageSnapshots({
  tenantId = null,
  walletId = null,
  includeLocal = true,
} = {}) {
  const candidates = [];

  if (includeLocal && (!tenantId || tenantId === "local")) {
    const localScope = discoverLocalScope();
    if (!walletId || walletId === localScope.walletId) {
      candidates.push(localScope);
    }
  }

  for (const scope of discoverWalletScopes()) {
    if (tenantId && scope.tenantId !== tenantId) continue;
    if (walletId && scope.walletId !== walletId) continue;
    candidates.push(scope);
  }

  const seen = new Set();
  const normalizedScopes = candidates.filter((scope) => {
    const key = `${scope.tenantId}:${scope.walletId}:${scope.dir}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const results = [];
  for (const scope of normalizedScopes) {
    const stores = [];

    for (const descriptor of SNAPSHOT_FILE_MAP) {
      const filePath = scope.dir === DATA_DIR
        ? path.join(DATA_DIR, descriptor.fileName)
        : path.join(scope.dir, descriptor.fileName);
      const content = readJsonIfExists(filePath);
      if (content == null) continue;

      const row = await upsertWalletStorageSnapshot({
        tenant_id: scope.tenantId,
        wallet_id: scope.walletId,
        store_key: descriptor.storeKey,
        content,
        metadata: {
          source: scope.source,
          bootstrap: true,
          file_path: filePath,
        },
      });

      stores.push({
        store_key: descriptor.storeKey,
        file_path: filePath,
        saved: Boolean(row),
      });
    }

    results.push({
      tenant_id: scope.tenantId,
      wallet_id: scope.walletId,
      source: scope.source,
      store_count: stores.filter((store) => store.saved).length,
      stores,
    });
  }

  return {
    scopes_processed: results.length,
    stores_written: results.reduce((sum, item) => sum + item.store_count, 0),
    scopes: results,
  };
}

export async function inspectRuntimeScopes() {
  const snapshotScopes = await listWalletStorageScopes();
  return {
    snapshots: snapshotScopes || [],
  };
}

export function getExpectedWalletDataDir({ tenantId = "local", walletId = process.env.WALLET_ADDRESS || "primary" } = {}) {
  return walletDataDir({ tenantId, walletId });
}

async function resolveSnapshotScopes({ tenantId = null, walletId = null } = {}) {
  if (tenantId && walletId) {
    return [{ tenant_id: tenantId, wallet_id: walletId }];
  }

  const scopes = await listWalletStorageScopes();
  if (!scopes) return [];

  return scopes.filter((scope) => {
    if (tenantId && scope.tenant_id !== tenantId) return false;
    if (walletId && scope.wallet_id !== walletId) return false;
    return true;
  });
}

export async function rehydrateWalletStorageSnapshots({
  tenantId = null,
  walletId = null,
  overwrite = false,
  storeKey = null,
} = {}) {
  const scopes = await resolveSnapshotScopes({ tenantId, walletId });
  const selectedDescriptors = storeKey
    ? SNAPSHOT_FILE_MAP.filter((descriptor) => descriptor.storeKey === storeKey)
    : SNAPSHOT_FILE_MAP;

  const results = [];

  for (const scope of scopes) {
    const targetDir = walletDataDir({
      tenantId: scope.tenant_id,
      walletId: scope.wallet_id,
    });

    const stores = [];
    for (const descriptor of selectedDescriptors) {
      const targetPath = path.join(targetDir, descriptor.fileName);
      const existing = readJsonIfExists(targetPath);
      if (existing != null && !overwrite) {
        stores.push({
          store_key: descriptor.storeKey,
          file_path: targetPath,
          restored: false,
          skipped: true,
          reason: "target_exists",
        });
        continue;
      }

      const snapshot = await getWalletStorageSnapshot({
        tenant_id: scope.tenant_id,
        wallet_id: scope.wallet_id,
        store_key: descriptor.storeKey,
      });

      if (!snapshot?.content) {
        stores.push({
          store_key: descriptor.storeKey,
          file_path: targetPath,
          restored: false,
          skipped: true,
          reason: "snapshot_missing",
        });
        continue;
      }

      writeJson(targetPath, snapshot.content);
      stores.push({
        store_key: descriptor.storeKey,
        file_path: targetPath,
        restored: true,
        updated_at: snapshot.updated_at || null,
      });
    }

    results.push({
      tenant_id: scope.tenant_id,
      wallet_id: scope.wallet_id,
      target_dir: targetDir,
      restored_count: stores.filter((store) => store.restored).length,
      stores,
    });
  }

  return {
    scopes_processed: results.length,
    stores_restored: results.reduce((sum, item) => sum + item.restored_count, 0),
    scopes: results,
  };
}
