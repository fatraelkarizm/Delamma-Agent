import { supportsLocalExecution } from "./telegram-view-service.js";

export function isLocalAttachedScope(scope, workerRuntime) {
  return Boolean(
    supportsLocalExecution(workerRuntime) &&
      scope?.tenantId &&
      scope?.walletId &&
      workerRuntime?.context?.tenantId &&
      workerRuntime?.context?.walletId &&
      scope.tenantId === workerRuntime.context.tenantId &&
      scope.walletId === workerRuntime.context.walletId
  );
}

export function isTelegramExecutionBusy(workerRuntime, runtimeState) {
  return Boolean(workerRuntime?.isExecutionBusy?.() || runtimeState?.busy);
}

