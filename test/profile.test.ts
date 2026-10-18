// Timing breakdown against the live ESI. Run with: LIVE=1 npx vitest run test/profile.test.ts --reporter=verbose --silent=false
import { readFileSync } from "node:fs";
import { it } from "vitest";
import loadHighs from "highs";
import { Sde } from "../src/data/sde";
import { runPlan } from "../src/core/plan";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import type { HighsLike } from "../src/core/optimizer";

const sde = new Sde(JSON.parse(readFileSync(new URL("../public/data/sde.json", import.meta.url), "utf8")));

it.skipIf(!process.env.LIVE)("profile Orca", { timeout: 300_000 }, async () => {
  const inner = (await loadHighs()) as unknown as HighsLike;
  const highs: HighsLike = {
    solve(lp, o) {
      const t = Date.now();
      const r = inner.solve(lp, o) as Awaited<ReturnType<HighsLike["solve"]>>;
      console.log(`  solve ${Date.now() - t} ms (${lp.length} chars) ${r.Status}`);
      return r;
    },
  };
  let t = Date.now();
  const r = await runPlan(sde, { ...DEFAULT_SETTINGS, productId: 28606 }, highs, (m) => {
    if (m.includes("/")) return;
    console.log(`${Date.now() - t} ms → ${m}`);
    t = Date.now();
  });
  console.log(`${Date.now() - t} ms → done`);
  for (const p of [r.volumePlan, r.costPlan]) console.log(`  ${Math.round(p.totalVolume)} m³, ${Math.round((p.totalCost ?? 0) / 1e6)}m ISK`);
});
