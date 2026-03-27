function cleanValue(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function createWorkerContext({
  tenantId = "local",
  walletId = process.env.WALLET_ADDRESS || "primary",
  workerId,
  mode = "local",
  channel = "runtime",
  metadata = {},
} = {}) {
  const normalizedTenantId = cleanValue(tenantId, "local");
  const normalizedWalletId = cleanValue(walletId, "primary");
  const normalizedMode = cleanValue(mode, "local");
  const normalizedChannel = cleanValue(channel, "runtime");
  const normalizedWorkerId = cleanValue(
    workerId,
    `${normalizedTenantId}:${normalizedWalletId}:${normalizedMode}`
  );

  return {
    tenantId: normalizedTenantId,
    walletId: normalizedWalletId,
    workerId: normalizedWorkerId,
    mode: normalizedMode,
    channel: normalizedChannel,
    metadata: { ...metadata },
  };
}

export function formatWorkerLabel(context) {
  return `[tenant:${context.tenantId} wallet:${context.walletId} worker:${context.workerId}]`;
}

export function describeWorkerContext(context) {
  return {
    tenant_id: context.tenantId,
    wallet_id: context.walletId,
    worker_id: context.workerId,
    mode: context.mode,
    channel: context.channel,
    metadata: { ...context.metadata },
  };
}
