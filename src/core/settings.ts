// User settings: defaults, persistence in localStorage, and export/import for moving between computers.

import type { OreKind, SecurityClass } from "../data/sde";
import type { RefineryStructure, RigTier } from "./reprocessing";

export type BuildStructure = "npc" | "raitaru" | "azbel" | "sotiyo" | "citadel";

export const BUILD_STRUCTURES: Record<BuildStructure, { label: string; materialBonus: number; costBonus: number }> = {
  npc: { label: "NPC station", materialBonus: 0, costBonus: 0 },
  raitaru: { label: "Raitaru", materialBonus: 0.01, costBonus: 0.03 },
  azbel: { label: "Azbel", materialBonus: 0.01, costBonus: 0.04 },
  sotiyo: { label: "Sotiyo", materialBonus: 0.01, costBonus: 0.05 },
  citadel: { label: "Citadel (Astrahus/Fortizar/Keepstar)", materialBonus: 0, costBonus: 0 },
};

/** Material bonus of manufacturing / reaction rigs before the security multiplier. */
export const RIG_MATERIAL_BONUS: Record<RigTier, number> = { 0: 0, 1: 0.02, 2: 0.024 };
export const MANUFACTURING_RIG_SECURITY: Record<SecurityClass, number> = { high: 1, low: 1.9, null: 2.1 };
export const REACTION_RIG_SECURITY: Record<SecurityClass, number> = { high: 1, low: 1, null: 1.1 };

export interface Settings {
  // Blueprint
  productId: number | null;
  runs: number;
  blueprintMe: number;
  componentMe: number;
  meOverrides: Record<number, number>;
  buyInstead: number[];
  expandReactions: boolean;
  // Manufacturing facility
  buildSystemId: number | null;
  buildStructure: BuildStructure;
  buildRig: RigTier;
  reactionRig: RigTier;
  facilityTaxPct: number;
  sccSurchargePct: number;
  // Refinery
  refineSystemId: number | null;
  refineStructure: RefineryStructure;
  refineRigs: Record<OreKind, RigTier>;
  reprocessingSkill: number;
  efficiencySkill: number;
  oreSkills: Record<number, number>;
  implantPct: number;
  refineTaxPct: number;
  yieldOverridePct: number | null;
  // Market & optimisation
  hubStationId: number;
  oreKinds: Record<OreKind, boolean>;
  allowCompressed: boolean;
  allowUncompressed: boolean;
  excludedOres: number[];
  freightPerM3: number;
  maxVolume: number;
  volumeSlackPct: number;
}

export const DEFAULT_SETTINGS: Settings = {
  productId: null,
  runs: 1,
  blueprintMe: 10,
  componentMe: 10,
  meOverrides: {},
  buyInstead: [],
  expandReactions: false,
  buildSystemId: null,
  buildStructure: "raitaru",
  buildRig: 1,
  reactionRig: 0,
  facilityTaxPct: 0.25,
  sccSurchargePct: 4,
  refineSystemId: null,
  refineStructure: "tatara",
  refineRigs: { ore: 1, moon: 1, ice: 0 },
  reprocessingSkill: 5,
  efficiencySkill: 5,
  oreSkills: {},
  implantPct: 0,
  refineTaxPct: 0,
  yieldOverridePct: null,
  hubStationId: 60003760,
  oreKinds: { ore: true, moon: false, ice: false },
  allowCompressed: true,
  allowUncompressed: true,
  excludedOres: [],
  freightPerM3: 0,
  maxVolume: 0,
  volumeSlackPct: 1,
};

const KEY = "oreptimiser.settings.v1";

export function normalise(value: unknown): Settings {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    refineRigs: { ...DEFAULT_SETTINGS.refineRigs, ...v.refineRigs },
    oreKinds: { ...DEFAULT_SETTINGS.oreKinds, ...v.oreKinds },
  };
}

export function loadSettings(): Settings {
  const fromLink = readShareHash();
  if (fromLink) return fromLink;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalise(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode etc.) – settings just won't persist.
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function shareLink(s: Settings): string {
  const url = new URL(window.location.href);
  url.hash = `s=${toBase64Url(JSON.stringify(s))}`;
  return url.toString();
}

function readShareHash(): Settings | null {
  const m = window.location.hash.match(/^#s=(.+)$/);
  if (!m) return null;
  try {
    const s = normalise(JSON.parse(fromBase64Url(m[1])));
    history.replaceState(null, "", window.location.pathname + window.location.search);
    saveSettings(s);
    return s;
  } catch {
    return null;
  }
}
