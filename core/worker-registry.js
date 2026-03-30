import {
  upsertWorkerProcess,
  deleteWorkerProcess,
  acquireWalletLeaseDb,
  getWalletLeaseDb,
  releaseWalletLeaseDb,
  listWorkerRuntimeState,
} from "../lib/db.js";
import { createWorkerContext, describeWorkerContext } from "./tenant-context.js";

const DEFAULT_LEASE_MS = 90_000;

function walletKey({ tenantId, walletId }) {
  return `${tenantId}:${walletId}`;
}

function normalizeWorkerRecord(context, metadata = {}) {
  return {
    ...describeWorkerContext(context),
    registered_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    metadata: { ...context.metadata, ...metadata },
  };
}

export function createWorkerRegistry({ defaultLeaseMs = DEFAULT_LEASE_MS } = {}) {
  const workers = new Map();
  const walletLeases = new Map();

  function cleanupExpiredLeases(now = Date.now()) {
    for (const [key, lease] of walletLeases.entries()) {
      if (new Date(lease.expires_at).getTime() <= now) {
        walletLeases.delete(key);
      }
    }
  }

  function updateMemoryWorker(context, metadata = {}) {
    const existing = workers.get(context.workerId);
    const next = existing
      ? {
          ...existing,
          last_seen_at: new Date().toISOString(),
          metadata: { ...(existing.metadata || {}), ...metadata },
        }
      : normalizeWorkerRecord(context, metadata);
    workers.set(context.workerId, next);
    return next;
  }

  async function registerWorker(contextInput, metadata = {}) {
    const context = createWorkerContext(contextInput);
    const fallback = updateMemoryWorker(context, metadata);
    const row = await upsertWorkerProcess({
      worker_id: context.workerId,
      tenant_id: context.tenantId,
      wallet_id: context.walletId,
      mode: context.mode,
      channel: context.channel,
      status: metadata.status || "registered",
      metadata: { ...context.metadata, ...metadata },
      lease_expires_at: null,
    });
    return row || fallback;
  }

  async function touchWorker(contextInput, metadata = {}) {
    const context = createWorkerContext(contextInput);
    const fallback = updateMemoryWorker(context, metadata);
    const currentLease = walletLeases.get(walletKey(context)) || null;
    const row = await upsertWorkerProcess({
      worker_id: context.workerId,
      tenant_id: context.tenantId,
      wallet_id: context.walletId,
      mode: context.mode,
      channel: context.channel,
      status: metadata.status || fallback.metadata?.status || "active",
      metadata: { ...context.metadata, ...fallback.metadata, ...metadata },
      lease_expires_at: currentLease?.expires_at || null,
    });
    return row || fallback;
  }

  async function unregisterWorker(contextInput) {
    const context = createWorkerContext(contextInput);
    await releaseWalletLease(context);
    workers.delete(context.workerId);
    return (await deleteWorkerProcess({ worker_id: context.workerId })) || true;
  }

  async function acquireWalletLease(contextInput, { ttlMs = defaultLeaseMs, metadata = {} } = {}) {
    const context = createWorkerContext(contextInput);
    cleanupExpiredLeases();
    await touchWorker(context, metadata);

    const dbResult = await acquireWalletLeaseDb({
      tenant_id: context.tenantId,
      wallet_id: context.walletId,
      worker_id: context.workerId,
      ttl_ms: ttlMs,
      metadata: { ...context.metadata, ...metadata },
    });

    if (dbResult) {
      if (dbResult.lease) {
        walletLeases.set(walletKey(context), dbResult.lease);
      }
      return dbResult;
    }

    const key = walletKey(context);
    const now = Date.now();
    const existing = walletLeases.get(key);
    if (existing && existing.worker_id !== context.workerId && new Date(existing.expires_at).getTime() > now) {
      return { acquired: false, lease: { ...existing } };
    }

    const lease = {
      tenant_id: context.tenantId,
      wallet_id: context.walletId,
      worker_id: context.workerId,
      acquired_at: existing?.acquired_at || new Date(now).toISOString(),
      renewed_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString(),
      metadata: { ...(existing?.metadata || {}), ...context.metadata, ...metadata },
    };
    walletLeases.set(key, lease);
    return { acquired: true, lease: { ...lease } };
  }

  async function renewWalletLease(contextInput, { ttlMs = defaultLeaseMs, metadata = {} } = {}) {
    return acquireWalletLease(contextInput, { ttlMs, metadata });
  }

  async function releaseWalletLease(contextInput) {
    const context = createWorkerContext(contextInput);
    const key = walletKey(context);
    const dbReleased = await releaseWalletLeaseDb({
      tenant_id: context.tenantId,
      wallet_id: context.walletId,
      worker_id: context.workerId,
    });

    const existing = walletLeases.get(key);
    if (existing?.worker_id === context.workerId) {
      walletLeases.delete(key);
    }

    if (dbReleased) return true;
    return Boolean(existing?.worker_id === context.workerId);
  }

  async function getWalletLease(contextInput) {
    const context = createWorkerContext(contextInput);
    cleanupExpiredLeases();

    const dbLease = await getWalletLeaseDb({
      tenant_id: context.tenantId,
      wallet_id: context.walletId,
    });

    if (dbLease) {
      walletLeases.set(walletKey(context), dbLease);
      return dbLease;
    }

    const lease = walletLeases.get(walletKey(context));
    return lease ? { ...lease } : null;
  }

  async function hasWalletLease(contextInput) {
    const context = createWorkerContext(contextInput);
    const lease = await getWalletLease(context);
    return Boolean(lease && lease.worker_id === context.workerId);
  }

  async function snapshot() {
    cleanupExpiredLeases();
    const dbState = await listWorkerRuntimeState();
    if (dbState) return dbState;

    return {
      workers: Array.from(workers.values()).map((worker) => ({ ...worker })),
      wallet_leases: Array.from(walletLeases.values()).map((lease) => ({ ...lease })),
    };
  }

  return {
    defaultLeaseMs,
    registerWorker,
    touchWorker,
    unregisterWorker,
    acquireWalletLease,
    renewWalletLease,
    releaseWalletLease,
    getWalletLease,
    hasWalletLease,
    snapshot,
  };
}

const defaultWorkerRegistry = createWorkerRegistry();

export function getDefaultWorkerRegistry() {
  return defaultWorkerRegistry;
}
