import { createWorkerContext } from "./tenant-context.js";
import { runWithRuntimeScope } from "./runtime-scope.js";
import { createWorkerStateStore } from "../lib/state.js";
import { createWorkerStrategyLibraryStore } from "../memory/strategy-library.js";
import { createWorkerLessonsStore } from "../memory/lessons.js";
import { createWorkerPoolMemoryStore } from "../memory/pool-memory.js";
import { createWorkerSmartWalletStore } from "../memory/smart-wallets.js";
import { createWorkerTokenBlacklistStore } from "../memory/token-blacklist.js";

export function createScopedRunner({ workerIdPrefix = "telegram", channel = "telegram-gateway" } = {}) {
  const cache = new Map();

  function getScopeRuntime(scope) {
    const key = `${scope.tenantId}:${scope.walletId}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    const workerContext = createWorkerContext({
      tenantId: scope.tenantId,
      walletId: scope.walletId,
      workerId: `${workerIdPrefix}:${scope.tenantId}:${scope.walletId}`,
      mode: workerIdPrefix,
      channel,
    });

    const scopedRuntime = {
      workerContext,
      stateStore: createWorkerStateStore(workerContext),
      strategyLibraryStore: createWorkerStrategyLibraryStore(workerContext),
      lessonsStore: createWorkerLessonsStore(workerContext),
      poolMemoryStore: createWorkerPoolMemoryStore(workerContext),
      smartWalletStore: createWorkerSmartWalletStore(workerContext),
      tokenBlacklistStore: createWorkerTokenBlacklistStore(workerContext),
    };

    cache.set(key, scopedRuntime);
    return scopedRuntime;
  }

  return {
    getScopeRuntime,
    run(scope, fn) {
      return runWithRuntimeScope(getScopeRuntime(scope), fn);
    },
  };
}

