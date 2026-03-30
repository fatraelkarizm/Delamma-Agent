import { createExecutionService, getDefaultExecutionService } from "./execution-service.js";
import { createWorkerContext, describeWorkerContext, formatWorkerLabel } from "./tenant-context.js";
import { getDefaultWorkerRegistry } from "./worker-registry.js";

export function createWorkerRuntime(options = {}) {
  const context = createWorkerContext(options);
  const registry = options.registry ?? getDefaultWorkerRegistry();
  const execution = createExecutionService(context, { registry, leaseTtlMs: options.leaseTtlMs });

  return {
    context,
    label: formatWorkerLabel(context),
    registry,
    describe() {
      return describeWorkerContext(context);
    },
    async snapshot() {
      return registry.snapshot();
    },
    ...execution,
  };
}

export function getDefaultWorkerRuntime() {
  const execution = getDefaultExecutionService();
  return {
    context: execution.context,
    label: execution.label,
    registry: execution.registry,
    describe() {
      return describeWorkerContext(execution.context);
    },
    async snapshot() {
      return execution.registry.snapshot();
    },
    ...execution,
  };
}
