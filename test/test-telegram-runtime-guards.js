/**
 * Offline smoke test for telegram runtime guards.
 * Run: node test/test-telegram-runtime-guards.js
 */

import { isLocalAttachedScope, isTelegramExecutionBusy } from "../core/telegram-runtime-guards.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function testIsLocalAttachedScope() {
  const scope = { tenantId: "tenant-a", walletId: "wallet-a" };
  const attachedWorker = {
    supportsLocalExecution: true,
    context: { tenantId: "tenant-a", walletId: "wallet-a" },
  };
  const remoteWorker = {
    supportsLocalExecution: false,
    context: { tenantId: "tenant-a", walletId: "wallet-a" },
  };
  const mismatchedWorker = {
    supportsLocalExecution: true,
    context: { tenantId: "tenant-b", walletId: "wallet-b" },
  };

  assert(isLocalAttachedScope(scope, attachedWorker) === true, "attached scope should pass");
  assert(isLocalAttachedScope(scope, remoteWorker) === false, "non-local execution should fail");
  assert(isLocalAttachedScope(scope, mismatchedWorker) === false, "mismatched scope should fail");
}

function testIsTelegramExecutionBusy() {
  const idleWorker = { isExecutionBusy: () => false };
  const busyWorker = { isExecutionBusy: () => true };

  assert(isTelegramExecutionBusy(idleWorker, { busy: false }) === false, "idle worker + state should be false");
  assert(isTelegramExecutionBusy(busyWorker, { busy: false }) === true, "busy worker should be true");
  assert(isTelegramExecutionBusy(idleWorker, { busy: true }) === true, "busy runtime state should be true");
}

function main() {
  testIsLocalAttachedScope();
  testIsTelegramExecutionBusy();
  console.log("Telegram runtime guards smoke test passed.");
}

main();

