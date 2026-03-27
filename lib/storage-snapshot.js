import { upsertWalletStorageSnapshot } from "./db.js";

export function createSnapshotWriter(workerContext, storeKey, metadata = {}) {
  if (!workerContext?.tenantId || !workerContext?.walletId || !storeKey) {
    return null;
  }

  return async (content) => {
    await upsertWalletStorageSnapshot({
      tenant_id: workerContext.tenantId,
      wallet_id: workerContext.walletId,
      store_key: storeKey,
      content,
      metadata: {
        worker_id: workerContext.workerId || null,
        mode: workerContext.mode || null,
        channel: workerContext.channel || null,
        ...metadata,
      },
    });
  };
}
