import type { IfcEntity, IfcLine, IfcTextSource } from "../types/ifc";

type WorkerSourceResponse =
  | { type: "lineRange"; requestId: number; lines: IfcLine[] }
  | { type: "entity"; requestId: number; entity: IfcEntity | null }
  | { type: "error"; requestId: number; message: string };

let nextRequestId = 1;

export function createWorkerIfcTextSource(worker: Worker, lineCount: number): IfcTextSource {
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();

  const handleMessage = (event: MessageEvent<WorkerSourceResponse>) => {
    const requestId = event.data?.requestId;
    if (!requestId || !pending.has(requestId)) return;

    const request = pending.get(requestId);
    pending.delete(requestId);
    if (!request) return;

    if (event.data.type === "error") {
      request.reject(new Error(event.data.message));
      return;
    }

    if (event.data.type === "lineRange") request.resolve(event.data.lines);
    if (event.data.type === "entity") request.resolve(event.data.entity);
  };

  worker.addEventListener("message", handleMessage as EventListener);

  function request<T>(message: Record<string, unknown>): Promise<T> {
    const requestId = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...message, requestId });
    });
  }

  return {
    getLineRange(startLine, count) {
      return request<IfcLine[]>({ type: "lineRange", startLine, count });
    },
    getEntityById(expressId) {
      return request<IfcEntity | null>({ type: "entity", id: expressId });
    },
    getLineCountEstimate() {
      return Promise.resolve(lineCount);
    },
    dispose() {
      worker.removeEventListener("message", handleMessage as EventListener);
      pending.forEach((request) => request.reject(new Error("IFC text source disposed")));
      pending.clear();
    }
  };
}
