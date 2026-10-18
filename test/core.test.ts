import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import loadHighs from "highs";
import { Sde } from "../src/data/sde";
import { expandBuild, jobMaterialQty, type IndustrySettings } from "../src/core/industry";
import { grossYield, type ReprocessingSettings } from "../src/core/reprocessing";
import { costOfUnits, optimize, reprocessOutput, type HighsLike, type OreOption } from "../src/core/optimizer";

const sde = new Sde(JSON.parse(readFileSync(new URL("../public/data/sde.json", import.meta.url), "utf8")));
let highs: HighsLike;
beforeAll(async () => {
  highs = (await loadHighs()) as unknown as HighsLike;
});

const TRITANIUM = 34;
const PYERITE = 35;
const MEXALLON = 36;
const RIFTER = 587;
const MALEDICTION = 11186;
const EXECUTIONER = 589;

const industry: IndustrySettings = {
  blueprintMe: 10,
  componentMe: 10,
  meOverrides: {},
  buyInstead: [],
  expandReactions: false,
  structureMaterialBonus: 0,
  rigMaterialBonus: 0,
  reactionRigMaterialBonus: 0,
};

describe("jobMaterialQty", () => {
  it("applies ME and rounds up", () => {
    expect(jobMaterialQty(1, 86, 10, 0, 0)).toBe(78); // 77.4 → 78
    expect(jobMaterialQty(10, 86, 10, 0.01, 0.02)).toBe(751); // 750.95…
  });
  it("never goes below one unit per run", () => {
    expect(jobMaterialQty(10, 1, 10, 0.01, 0.042)).toBe(10);
  });
});

describe("reprocessing yield", () => {
  const base: ReprocessingSettings = {
    structure: "tatara",
    security: "null",
    rigs: { ore: 2, moon: 2, ice: 2 },
    reprocessingSkill: 5,
    efficiencySkill: 5,
    oreSkills: {},
    implant: 0.04,
    tax: 0,
    yieldOverride: null,
  };
  const veldspar = sde.ores.find((o) => sde.name(o.id) === "Veldspar")!;
  it("reaches the known maximum of ~90.6%", () => {
    expect(grossYield(veldspar, { ...base, oreSkills: { [veldspar.skillId]: 5 } })).toBeCloseTo(0.9063, 3);
  });
  it("uses a flat 50% base in NPC stations", () => {
    const y = grossYield(veldspar, { ...base, structure: "npc", reprocessingSkill: 0, efficiencySkill: 0, implant: 0 });
    expect(y).toBe(0.5);
  });
});

describe("expandBuild", () => {
  it("expands a T2 ship down to the T1 hull minerals", () => {
    const plan = expandBuild(sde, MALEDICTION, 1, industry);
    expect(plan.steps[0].typeId).toBe(MALEDICTION);
    const hull = plan.steps.find((s) => s.typeId === EXECUTIONER);
    expect(hull).toBeDefined();
    expect(hull!.depth).toBe(1);
    expect(plan.leaves.get(TRITANIUM)).toBeGreaterThan(0);
    expect(plan.leaves.has(EXECUTIONER)).toBe(false);
  });
  it("respects buy-instead overrides", () => {
    const plan = expandBuild(sde, MALEDICTION, 1, { ...industry, buyInstead: [EXECUTIONER] });
    expect(plan.steps.some((s) => s.typeId === EXECUTIONER)).toBe(false);
    expect(plan.leaves.get(EXECUTIONER)).toBe(1);
  });
  it("produces only minerals for a T1 frigate", () => {
    const plan = expandBuild(sde, RIFTER, 1, industry);
    expect(plan.steps).toHaveLength(1);
    expect(plan.leaves.get(TRITANIUM)).toBeGreaterThan(0);
  });
});

describe("optimize", () => {
  const unlimited = (price: number) => [{ price, units: 1e9 }];
  const option = (name: string, price: number): OreOption => {
    const ore = sde.ores.find((o) => sde.name(o.id) === name)!;
    const portionSize = sde.portionSize(ore.id);
    return {
      oreId: ore.id,
      portionSize,
      portionVolume: portionSize * sde.volume(ore.id),
      yields: ore.yields,
      efficiency: 0.8,
      orders: unlimited(price),
    };
  };

  it("walks the order book for cost", () => {
    expect(costOfUnits([{ price: 1, units: 10 }, { price: 2, units: 10 }], 15)).toBe(20);
    expect(costOfUnits([{ price: 1, units: 10 }], 15)).toBe(Infinity);
  });

  it("covers the requirements after in-game rounding", async () => {
    const options = ["Veldspar", "Compressed Veldspar", "Scordite", "Compressed Scordite", "Plagioclase"].map((n, i) =>
      option(n, 10 + i),
    );
    const requirements = new Map([[TRITANIUM, 123_457], [PYERITE, 20_001], [MEXALLON, 5_003]]);
    for (const objective of ["volume", "cost"] as const) {
      const r = await optimize(highs, { requirements, options, objective });
      expect(r.status).toBe("optimal");
      const out = reprocessOutput(options, new Map(r.purchases.map((p) => [p.oreId, p.portions])));
      for (const [t, q] of requirements) expect(out.get(t) ?? 0).toBeGreaterThanOrEqual(q);
    }
  });

  it("prefers compressed ore for volume and respects market depth", async () => {
    const options = [option("Veldspar", 1), option("Compressed Veldspar", 100)];
    const requirements = new Map([[TRITANIUM, 100_000]]);
    const small = await optimize(highs, { requirements, options, objective: "volume" });
    expect(small.purchases.map((p) => sde.name(p.oreId))).toEqual(["Compressed Veldspar"]);
    const cheap = await optimize(highs, { requirements, options, objective: "cost" });
    expect(cheap.purchases.map((p) => sde.name(p.oreId))).toEqual(["Veldspar"]);

    // Only 10 000 cheap Veldspar on the market: the rest must come from compressed.
    options[0].orders = [{ price: 1, units: 10_000 }];
    const limited = await optimize(highs, { requirements, options, objective: "cost" });
    const veld = limited.purchases.find((p) => sde.name(p.oreId) === "Veldspar");
    expect(veld?.units).toBe(10_000);
  });

  it("reports materials no ore can supply", async () => {
    const r = await optimize(highs, {
      requirements: new Map([[TRITANIUM, 1000], [11399, 5]]), // Morphite needs Mercoxit
      options: [option("Veldspar", 1)],
      objective: "volume",
    });
    expect(r.uncovered).toEqual([11399]);
    expect(r.status).toBe("optimal");
  });

  it("handles a cargo limit and freight in cost mode", async () => {
    const options = [option("Veldspar", 1), option("Compressed Veldspar", 120)];
    const requirements = new Map([[TRITANIUM, 100_000]]);
    const capped = await optimize(highs, { requirements, options, objective: "cost", maxVolume: 50 });
    expect(capped.totalVolume).toBeLessThanOrEqual(50);
    const freight = await optimize(highs, { requirements, options, objective: "cost", freightPerM3: 2000 });
    expect(freight.purchases.map((p) => sde.name(p.oreId))).toEqual(["Compressed Veldspar"]);
  });
});
