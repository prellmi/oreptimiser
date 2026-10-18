// Reprocessing yield.
//
// Upwell structures: (50 + rig) × (1 + security) × (1 + structure) × skills × implant
// NPC stations:       50 × skills × implant
// skills = (1 + 0.03 × Reprocessing) × (1 + 0.02 × Reprocessing Efficiency) × (1 + 0.02 × ore processing skill)
// The station/structure tax is withheld from the output.

import type { Ore, OreKind, SecurityClass } from "../data/sde";

export type RefineryStructure = "npc" | "athanor" | "tatara" | "other";
export type RigTier = 0 | 1 | 2;

export const STRUCTURE_BONUS: Record<RefineryStructure, number> = { npc: 0, athanor: 0.02, tatara: 0.055, other: 0 };
export const RIG_BASE: Record<RigTier, number> = { 0: 0, 1: 1, 2: 3 };
export const SECURITY_BONUS: Record<SecurityClass, number> = { high: 0, low: 0.06, null: 0.12 };

export interface ReprocessingSettings {
  structure: RefineryStructure;
  security: SecurityClass;
  rigs: Record<OreKind, RigTier>;
  reprocessingSkill: number;
  efficiencySkill: number;
  /** Ore processing skill levels keyed by skill type id. */
  oreSkills: Record<number, number>;
  /** Implant bonus as fraction (0, 0.01, 0.02, 0.04). */
  implant: number;
  /** Tax withheld, as fraction. */
  tax: number;
  /** If set, replaces the calculated yield (before tax) for every ore, as fraction. */
  yieldOverride: number | null;
}

/** Yield before tax for one ore. */
export function grossYield(ore: Ore, s: ReprocessingSettings): number {
  if (s.yieldOverride != null) return s.yieldOverride;
  const skills =
    (1 + 0.03 * s.reprocessingSkill) * (1 + 0.02 * s.efficiencySkill) * (1 + 0.02 * (s.oreSkills[ore.skillId] ?? 0));
  if (s.structure === "npc") return 0.5 * skills * (1 + s.implant);
  const rig = RIG_BASE[s.rigs[ore.kind]];
  const sec = rig > 0 ? SECURITY_BONUS[s.security] : 0;
  return ((50 + rig) / 100) * (1 + sec) * (1 + STRUCTURE_BONUS[s.structure]) * skills * (1 + s.implant);
}

/** Effective fraction of the listed materials received, after tax. */
export function netYield(ore: Ore, s: ReprocessingSettings): number {
  return grossYield(ore, s) * (1 - s.tax);
}
