import { AsyncLocalStorage } from "async_hooks";

const runtimeScopeStorage = new AsyncLocalStorage();

export function runWithRuntimeScope(scope, fn) {
  return runtimeScopeStorage.run(scope, fn);
}

export function getRuntimeScope() {
  return runtimeScopeStorage.getStore() || null;
}
