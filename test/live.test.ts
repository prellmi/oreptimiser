// End-to-end check against the live ESI. Run with: LIVE=1 npx vitest run test/live.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import loadHighs from "highs";
import { Sde } from "../src/data/sde";
import { runPlan } from "../src/core/plan";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import type { HighsLike } from "../src/core/optimizer";

const sde = new Sde(JSON.parse(readFileSync(new URL("../public/data/sde.json", import.meta.url), "utf8")));
const JITA = 30000142;

describe.skipIf(!process.env.LIVE)("live plan", () => {
  for (const [name, typeId] of [["Rifter", 587], ["Malediction", 11186], ["Orca", 28606]] as const) {
    it(`plans ${name}`, { timeout: 120_000 }, async () => {
      const highs = (await loadHighs()) as unknown as HighsLike;
      const t0 = Date.now();
      const r = await runPlan(sde, { ...DEFAULT_SETTINGS, productId: typeId, buildSystemId: JITA }, highs, () => {});
      const fmt = (p: typeof r.volumePlan) =>
        `${p.status} ${Math.round(p.totalVolume)} m³ ${Math.round((p.totalCost ?? 0) / 1e6)}m ISK: ` +
        p.purchases.map((x) => `${sde.name(x.oreId)}×${x.units}`).join(", ");
      console.log(`${name} (${Date.now() - t0} ms)\n  volume: ${fmt(r.volumePlan)}\n  cost:   ${fmt(r.costPlan)}` +
        `\n  other: ${r.otherMaterials.length} items, jobs ${Math.round(r.totalJobCost)} ISK`);
      expect(r.volumePlan.status).toBe("optimal");
      expect(r.costPlan.status).toBe("optimal");
      expect(r.volumePlan.totalVolume).toBeLessThanOrEqual(r.costPlan.totalVolume + 1e-6);
      expect(r.costPlan.totalCost!).toBeLessThanOrEqual(r.volumePlan.totalCost! + 1e-6);
      for (const [t, q] of r.oreRequirements) {
        expect(r.volumePlan.output.get(t) ?? 0).toBeGreaterThanOrEqual(q);
        expect(r.costPlan.output.get(t) ?? 0).toBeGreaterThanOrEqual(q);
      }
    });
  }
});
