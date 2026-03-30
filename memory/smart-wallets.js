import fs from "fs";
import path from "path";
import { getRuntimeScope } from "../core/runtime-scope.js";
import { log } from "../lib/logger.js";
import { dataPath, walletDataPath } from "../lib/paths.js";
import { createSnapshotWriter } from "../lib/storage-snapshot.js";

const DEFAULT_WALLETS_PATH = dataPath("smart-wallets.json");
const LEGACY_WALLETS_PATH = dataPath("..", "memory", "smart-wallets.json");
const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CACHE_TTL = 5 * 60 * 1000;

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function createSmartWalletStore({
  filePath = DEFAULT_WALLETS_PATH,
  legacyFilePath = LEGACY_WALLETS_PATH,
  snapshotWriter = null,
} = {}) {
  const cache = new Map();

  function loadWallets() {
    const sourcePath = fs.existsSync(filePath)
      ? filePath
      : (fs.existsSync(legacyFilePath) ? legacyFilePath : null);
    if (!sourcePath) return { wallets: [] };
    try {
      return JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    } catch {
      return { wallets: [] };
    }
  }

  function saveWallets(data) {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    if (snapshotWriter) {
      void snapshotWriter(data);
    }
  }

  function addSmartWallet({ name, address, category = "alpha", type = "lp" }) {
    if (!SOLANA_PUBKEY_RE.test(address)) {
      return { success: false, error: "Invalid Solana address format" };
    }
    const data = loadWallets();
    const existing = data.wallets.find((wallet) => wallet.address === address);
    if (existing) {
      return { success: false, error: `Already tracked as "${existing.name}"` };
    }
    data.wallets.push({ name, address, category, type, addedAt: new Date().toISOString() });
    saveWallets(data);
    cache.delete(address);
    log("smart_wallets", `Added wallet: ${name} (${category}, type=${type})`);
    return { success: true, wallet: { name, address, category, type } };
  }

  function removeSmartWallet({ address }) {
    const data = loadWallets();
    const wallet = data.wallets.find((item) => item.address === address);
    if (!wallet) return { success: false, error: "Wallet not found" };
    data.wallets = data.wallets.filter((item) => item.address !== address);
    saveWallets(data);
    cache.delete(address);
    log("smart_wallets", `Removed wallet: ${wallet.name}`);
    return { success: true, removed: wallet.name };
  }

  function listSmartWallets() {
    const { wallets } = loadWallets();
    return { total: wallets.length, wallets };
  }

  async function checkSmartWalletsOnPool({ pool_address }) {
    const { wallets: allWallets } = loadWallets();
    const wallets = allWallets.filter((wallet) => !wallet.type || wallet.type === "lp");
    if (wallets.length === 0) {
      return {
        pool: pool_address,
        tracked_wallets: 0,
        in_pool: [],
        confidence_boost: false,
        signal: "No smart wallets tracked yet - neutral signal",
      };
    }

    const { getWalletPositions } = await import("../tools/dlmm.js");

    const results = await Promise.all(
      wallets.map(async (wallet) => {
        try {
          const cached = cache.get(wallet.address);
          if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
            return { wallet, positions: cached.positions };
          }
          const { positions } = await getWalletPositions({ wallet_address: wallet.address });
          cache.set(wallet.address, { positions: positions || [], fetchedAt: Date.now() });
          return { wallet, positions: positions || [] };
        } catch {
          return { wallet, positions: [] };
        }
      })
    );

    const inPool = results
      .filter((result) => result.positions.some((position) => position.pool === pool_address))
      .map((result) => ({
        name: result.wallet.name,
        category: result.wallet.category,
        address: result.wallet.address,
      }));

    return {
      pool: pool_address,
      tracked_wallets: wallets.length,
      in_pool: inPool,
      confidence_boost: inPool.length > 0,
      signal: inPool.length > 0
        ? `${inPool.length}/${wallets.length} smart wallet(s) are in this pool: ${inPool.map((wallet) => wallet.name).join(", ")} - STRONG signal`
        : `0/${wallets.length} smart wallets in this pool - neutral, rely on fundamentals`,
    };
  }

  return {
    filePath,
    loadWallets,
    saveWallets,
    addSmartWallet,
    removeSmartWallet,
    listSmartWallets,
    checkSmartWalletsOnPool,
  };
}

export function createWorkerSmartWalletStore(workerContext = {}) {
  return createSmartWalletStore({
    filePath: walletDataPath(workerContext, "smart-wallets.json"),
    snapshotWriter: createSnapshotWriter(workerContext, "smart-wallets"),
  });
}

const defaultSmartWalletStore = createSmartWalletStore();

export function getDefaultSmartWalletStore() {
  return defaultSmartWalletStore;
}

function resolveSmartWalletStore() {
  return getRuntimeScope()?.smartWalletStore || defaultSmartWalletStore;
}

export function addSmartWallet(input) {
  return resolveSmartWalletStore().addSmartWallet(input);
}

export function removeSmartWallet(input) {
  return resolveSmartWalletStore().removeSmartWallet(input);
}

export function listSmartWallets() {
  return resolveSmartWalletStore().listSmartWallets();
}

export async function checkSmartWalletsOnPool(input) {
  return resolveSmartWalletStore().checkSmartWalletsOnPool(input);
}
