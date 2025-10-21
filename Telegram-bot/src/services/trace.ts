import { AsyncLocalStorage } from 'node:async_hooks';

const traceStore = new AsyncLocalStorage<{ trace_id: string }>();

export function getTraceId(): string {
  return traceStore.getStore()?.trace_id || '';
}

export function generateTraceId(prefix = 'trace'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return traceStore.run({ trace_id: traceId }, fn);
}

export function withTrace<T>(traceId: string, fn: () => T): T {
  return runWithTrace(traceId, fn);
}
