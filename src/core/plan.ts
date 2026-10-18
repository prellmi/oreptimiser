// Ties everything together: settings → build tree → market data → optimised ore plans.

import { securityClass, type Hub, type Ore, type Sde } from "../data/sde";
import { adjustedPrices, costIndices, sellOrdersMany, type SystemCostIndices } from "./esi";
import { expandBuild, jobInstallCost, type BuildPlan, type IndustrySettings } from "./industry";
import { costOfUnits, optimize, type HighsLike, type OptimizeResult, type OreOption, type PriceLevel } from "./optimizer";
import { grossYield, netYield, type ReprocessingSettings } from "./reprocessing";
import {
  BUILD_STRUCTURES,
  MANUFACTURING_RIG_SECURITY,
  REACTION_RIG_SECURITY,
  RIG_MATERIAL_BONUS,
  type Settings,
} from "./settings";

export function industrySettings(sde: Sde, s: Settings): IndustrySettings {
  const sys = s.buildSystemId ? sde.systemById.get(s.buildSystemId) : undefined;
  const sec = sys ? securityClass(sys.security) : "high";
  const inStructure = s.buildStructure !== "npc";
  return {
    blueprintMe: s.blueprintMe,
    componentMe: s.componentMe,
    meOverrides: s.meOverrides,
    buyInstead: s.buyInstead,
    expandReactions: s.expandReactions,
    structureMaterialBonus: BUILD_STRUCTURES[s.buildStructure].materialBonus,
    rigMaterialBonus: inStructure ? RIG_MATERIAL_BONUS[s.buildRig] * MANUFACTURING_RIG_SECURITY[sec] : 0,
    reactionRigMaterialBonus: RIG_MATERIAL_BONUS[s.reactionRig] * REACTION_RIG_SECURITY[sec],
  };
}

export function reprocessingSettings(sde: Sde, s: Settings): ReprocessingSettings {
  const sys = s.refineSystemId ? sde.systemById.get(s.refineSystemId) : undefined;
  return {
    structure: s.refineStructure,
    security: sys ? securityClass(sys.security) : "high",
    rigs: s.refineRigs,
    reprocessingSkill: s.reprocessingSkill,
    efficiencySkill: s.efficiencySkill,
    oreSkills: s.oreSkills,
    implant: s.implantPct / 100,
    tax: s.refineTaxPct / 100,
    yieldOverride: s.yieldOverridePct != null ? s.yieldOverridePct / 100 : null,
  };
}

export function buildPlan(sde: Sde, s: Settings): BuildPlan | null {
  if (!s.productId || s.runs < 1) return null;
  return expandBuild(sde, s.productId, s.runs, industrySettings(sde, s));
}

/** Ores allowed by the settings. */
export function candidateOres(sde: Sde, s: Settings): Ore[] {
  const excluded = new Set(s.excludedOres);
  return sde.ores.filter(
    (o) =>
      s.oreKinds[o.kind] &&
      (o.compressed ? s.allowCompressed : s.allowUncompressed) &&
      !excluded.has(o.id),
  );
}

export interface OtherMaterial {
  typeId: number;
  qty: number;
  volume: number;
  cost?: number;
}

export interface PlanResult {
  hub: Hub;
  build: BuildPlan;
  /** Materials that are covered by reprocessing ores. */
  oreRequirements: Map<number, number>;
  /** Raw materials that cannot come from the allowed ores (PI, moon goo, salvage, …). */
  otherMaterials: OtherMaterial[];
  volumePlan: OptimizeResult;
  costPlan: OptimizeResult;
  /** Gross yield (before tax) per ore id, for display. */
  yields: Map<number, number>;
  jobCosts: Map<number, number>;
  totalJobCost: number;
  indices?: SystemCostIndices;
  /** Hub price per required material, for comparison. */
  materialPrices: Map<number, number>;
}

export async function runPlan(
  sde: Sde,
  s: Settings,
  highs: HighsLike,
  onProgress: (message: string) => void,
): Promise<PlanResult> {
  const build = buildPlan(sde, s);
  if (!build) throw new Error("Select a blueprint first.");
  const hub = sde.hubs.find((h) => h.stationId === s.hubStationId) ?? sde.hubs[0];
  const rs = reprocessingSettings(sde, s);

  const ores = candidateOres(sde, s);
  const oreOutputs = new Set(ores.flatMap((o) => o.yields.map((y) => y.typeId)));
  const oreRequirements = new Map([...build.leaves].filter(([t]) => oreOutputs.has(t)));
  const others = [...build.leaves].filter(([t]) => !oreOutputs.has(t));
  const relevantOres = ores.filter((o) => o.yields.some((y) => oreRequirements.has(y.typeId)));

  const marketTypes = [...new Set([...relevantOres.map((o) => o.id), ...build.leaves.keys()])];
  onProgress(`Loading ${marketTypes.length} order books from ${sde.systemById.get(hub.systemId)?.name ?? "hub"}…`);
  const [books, prices, indices] = await Promise.all([
    sellOrdersMany(hub.regionId, hub.stationId, marketTypes, (d, t) => onProgress(`Loading order books… ${d}/${t}`)),
    adjustedPrices().catch(() => new Map<number, number>()),
    costIndices().catch(() => new Map<number, SystemCostIndices>()),
  ]);

  const yields = new Map<number, number>();
  const options: OreOption[] = relevantOres.map((o) => {
    yields.set(o.id, grossYield(o, rs));
    const portionSize = sde.portionSize(o.id);
    return {
      oreId: o.id,
      portionSize,
      portionVolume: portionSize * sde.volume(o.id),
      yields: o.yields,
      efficiency: netYield(o, rs),
      orders: books.get(o.id) ?? [],
    };
  });

  onProgress("Optimising for smallest volume…");
  const maxVolume = s.maxVolume > 0 ? s.maxVolume : undefined;
  const volumePlan = await optimize(highs, { requirements: oreRequirements, options, objective: "volume", maxVolume, volumeSlack: s.volumeSlackPct / 100 });
  onProgress("Optimising for lowest cost…");
  const costPlan = await optimize(highs, {
    requirements: oreRequirements,
    options,
    objective: "cost",
    freightPerM3: s.freightPerM3,
    maxVolume,
  });

  const otherMaterials: OtherMaterial[] = others.map(([typeId, qty]) => {
    const cost = costOfUnits(books.get(typeId) ?? [], qty);
    return { typeId, qty, volume: qty * sde.volume(typeId), cost: Number.isFinite(cost) ? cost : undefined };
  });

  const materialPrices = new Map<number, number>();
  for (const [typeId] of build.leaves) {
    const book: PriceLevel[] = books.get(typeId) ?? [];
    if (book.length) materialPrices.set(typeId, book[0].price);
  }

  const idx = s.buildSystemId ? indices.get(s.buildSystemId) : undefined;
  const jobCosts = new Map<number, number>();
  for (const step of build.steps) {
    jobCosts.set(
      step.typeId,
      jobInstallCost(step, prices, {
        manufacturingCostIndex: idx?.manufacturing ?? 0,
        reactionCostIndex: idx?.reaction ?? 0,
        structureCostBonus: BUILD_STRUCTURES[s.buildStructure].costBonus,
        facilityTax: s.facilityTaxPct / 100,
        sccSurcharge: s.sccSurchargePct / 100,
      }),
    );
  }

  return {
    hub,
    build,
    oreRequirements,
    otherMaterials,
    volumePlan,
    costPlan,
    yields,
    jobCosts,
    totalJobCost: [...jobCosts.values()].reduce((a, b) => a + b, 0),
    indices: idx,
    materialPrices,
  };
}
