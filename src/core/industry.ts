// Manufacturing / reaction material maths and full build-tree expansion.

import type { Blueprint, Sde } from "../data/sde";

export interface IndustrySettings {
  /** ME of the top-level blueprint (0-10). */
  blueprintMe: number;
  /** Default ME assumed for blueprints of intermediate components. */
  componentMe: number;
  /** Per-product ME overrides for intermediate components. */
  meOverrides: Record<number, number>;
  /** Products that should be bought instead of built. */
  buyInstead: number[];
  /** Expand reaction formulas (composites, fuel blocks inputs etc.) too. */
  expandReactions: boolean;
  /** Material reduction of the manufacturing structure (e.g. 0.01 for Engineering Complexes). */
  structureMaterialBonus: number;
  /** Material reduction from manufacturing rigs, already multiplied by the security modifier. */
  rigMaterialBonus: number;
  /** Material reduction from reaction rigs, already multiplied by the security modifier. */
  reactionRigMaterialBonus: number;
}

export interface BuildStep {
  typeId: number;
  blueprint: Blueprint;
  /** Units of this item required by its consumers (or the top-level order). */
  needed: number;
  runs: number;
  produced: number;
  me: number;
  /** Longest distance from the top-level item, 0 for the top-level item itself. */
  depth: number;
  /** Actual materials consumed by this job after ME/bonuses. */
  materials: { typeId: number; qty: number }[];
}

export interface BuildPlan {
  /** Jobs in dependency order: every job appears before the jobs producing its inputs. */
  steps: BuildStep[];
  /** Raw materials that need to be acquired (not built). */
  leaves: Map<number, number>;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Quantity of one material consumed by a job, as computed by the game. */
export function jobMaterialQty(runs: number, baseQty: number, me: number, structureBonus: number, rigBonus: number): number {
  const modifier = (1 - me / 100) * (1 - structureBonus) * (1 - rigBonus);
  return Math.max(runs, Math.ceil(round2(runs * baseQty * modifier)));
}

export function expandBuild(sde: Sde, productId: number, topRuns: number, s: IndustrySettings): BuildPlan {
  const buy = new Set(s.buyInstead);
  const isBuilt = (typeId: number): Blueprint | undefined => {
    const bp = sde.blueprintByProduct.get(typeId);
    if (!bp) return undefined;
    if (typeId === productId) return bp;
    if (buy.has(typeId)) return undefined;
    if (bp.activity === "reaction" && !s.expandReactions) return undefined;
    return bp;
  };

  const root = isBuilt(productId);
  if (!root) throw new Error(`${sde.name(productId)} has no blueprint`);

  // Depth-first post-order over built items; reversed it gives consumers before producers.
  const order: number[] = [];
  const visited = new Set<number>();
  const visit = (typeId: number) => {
    if (visited.has(typeId)) return; // also guards against cycles (none exist in EVE data)
    visited.add(typeId);
    for (const m of isBuilt(typeId)!.materials) {
      if (isBuilt(m.typeId) && m.typeId !== productId) visit(m.typeId);
    }
    order.push(typeId);
  };
  visit(productId);
  order.reverse();

  const depth = new Map<number, number>([[productId, 0]]);
  for (const typeId of order) {
    const d = depth.get(typeId) ?? 0;
    for (const m of isBuilt(typeId)!.materials) {
      if (isBuilt(m.typeId) && m.typeId !== productId) depth.set(m.typeId, Math.max(depth.get(m.typeId) ?? 0, d + 1));
    }
  }

  const demand = new Map<number, number>([[productId, topRuns * root.productQty]]);
  const leaves = new Map<number, number>();
  const steps: BuildStep[] = [];
  for (const typeId of order) {
    const bp = isBuilt(typeId)!;
    const needed = demand.get(typeId) ?? 0;
    if (needed <= 0) continue;
    const runs = typeId === productId ? topRuns : Math.ceil(needed / bp.productQty);
    const isReaction = bp.activity === "reaction";
    const me = isReaction ? 0 : typeId === productId ? s.blueprintMe : (s.meOverrides[typeId] ?? s.componentMe);
    const structureBonus = isReaction ? 0 : s.structureMaterialBonus;
    const rigBonus = isReaction ? s.reactionRigMaterialBonus : s.rigMaterialBonus;
    const materials = bp.materials.map((m) => ({
      typeId: m.typeId,
      qty: jobMaterialQty(runs, m.qty, me, structureBonus, rigBonus),
    }));
    for (const m of materials) {
      if (isBuilt(m.typeId) && m.typeId !== productId) {
        demand.set(m.typeId, (demand.get(m.typeId) ?? 0) + m.qty);
      } else {
        leaves.set(m.typeId, (leaves.get(m.typeId) ?? 0) + m.qty);
      }
    }
    steps.push({
      typeId, blueprint: bp, needed, runs, produced: runs * bp.productQty, me, depth: depth.get(typeId) ?? 0, materials,
    });
  }
  return { steps, leaves };
}

export interface JobCostSettings {
  manufacturingCostIndex: number;
  reactionCostIndex: number;
  /** Structure role bonus reducing the system cost index part (e.g. 0.03 for a Raitaru). */
  structureCostBonus: number;
  /** Facility tax as a fraction (0.0025 = 0.25% in NPC stations). */
  facilityTax: number;
  /** SCC surcharge as a fraction of the estimated item value. */
  sccSurcharge: number;
}

/** Install cost of one job. EIV uses the unmodified (ME 0) blueprint quantities. */
export function jobInstallCost(step: BuildStep, adjustedPrices: Map<number, number>, c: JobCostSettings): number {
  const eivPerRun = step.blueprint.materials.reduce((sum, m) => sum + m.qty * (adjustedPrices.get(m.typeId) ?? 0), 0);
  const eiv = eivPerRun * step.runs;
  const index = step.blueprint.activity === "reaction" ? c.reactionCostIndex : c.manufacturingCostIndex;
  return eiv * (index * (1 - c.structureCostBonus) + c.facilityTax + c.sccSurcharge);
}
