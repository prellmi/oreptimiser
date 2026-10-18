// HiGHS solver running in a Web Worker, exposed through the async HighsLike interface.

import type { HighsLike, HighsSolution } from "./optimizer";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (r: HighsSolution) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; result?: HighsSolution; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error != null) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result!);
  };
  worker.onerror = (e) => {
    // A crashed WebAssembly instance cannot be reused: fail pending solves and start fresh next time.
    for (const p of pending.values()) p.reject(new Error(e.message || "Solver crashed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export const highs: HighsLike = {
  solve(lp, options) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, lp, options });
    });
  },
};
