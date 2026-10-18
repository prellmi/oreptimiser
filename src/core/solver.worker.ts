// Runs HiGHS off the main thread so the page stays responsive during long solves.

import loadHighs from "highs";
import wasmUrl from "highs/runtime?url";

const highs = loadHighs({ locateFile: () => wasmUrl });

self.onmessage = async (e: MessageEvent<{ id: number; lp: string; options: Record<string, unknown> }>) => {
  const { id, lp, options } = e.data;
  try {
    const result = (await highs).solve(lp, options as never);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
