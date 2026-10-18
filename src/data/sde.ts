// Shape of public/data/sde.json (produced by scripts/build-sde.mjs) and a typed wrapper around it.

export type OreKind = "ore" | "moon" | "ice";

interface RawSde {
  meta: { build: number; released: string; generated: string };
  types: Record<string, [name: string, volume: number, portionSize: number]>;
  blueprints: { id: number; a: "m" | "r"; p: number; q: number; m: [number, number][]; max: number }[];
  ores: { id: number; k: OreKind; c: 0 | 1; g: string; s: number; y: [number, number][] }[];
  skills: Record<string, string>;
  regions: Record<string, string>;
  systems: [id: number, name: string, security: number, regionId: number, neighbours: number[]][];
  hubs: Hub[];
}

export interface Hub {
  stationId: number;
  name: string;
  systemId: number;
  regionId: number;
}

export interface Blueprint {
  id: number;
  activity: "manufacturing" | "reaction";
  product: number;
  productQty: number;
  materials: { typeId: number; qty: number }[];
  maxRuns: number;
}

export interface Ore {
  id: number;
  kind: OreKind;
  compressed: boolean;
  group: string;
  skillId: number;
  /** Materials obtained from reprocessing one portion at 100% yield. */
  yields: { typeId: number; qty: number }[];
}

export interface SolarSystem {
  id: number;
  name: string;
  security: number;
  regionId: number;
  neighbours: number[];
}

export class Sde {
  readonly meta: RawSde["meta"];
  readonly blueprints: Blueprint[];
  readonly blueprintByProduct = new Map<number, Blueprint>();
  readonly ores: Ore[];
  readonly skills: Map<number, string>;
  readonly regions: Map<number, string>;
  readonly systems: SolarSystem[];
  readonly systemById = new Map<number, SolarSystem>();
  readonly hubs: Hub[];
  private readonly types: RawSde["types"];

  constructor(raw: RawSde) {
    this.meta = raw.meta;
    this.types = raw.types;
    this.blueprints = raw.blueprints.map((b) => ({
      id: b.id,
      activity: b.a === "m" ? "manufacturing" : "reaction",
      product: b.p,
      productQty: b.q,
      materials: b.m.map(([typeId, qty]) => ({ typeId, qty })),
      maxRuns: b.max,
    }));
    for (const bp of this.blueprints) this.blueprintByProduct.set(bp.product, bp);
    this.ores = raw.ores.map((o) => ({
      id: o.id,
      kind: o.k,
      compressed: o.c === 1,
      group: o.g,
      skillId: o.s,
      yields: o.y.map(([typeId, qty]) => ({ typeId, qty })),
    }));
    this.skills = new Map(Object.entries(raw.skills).map(([k, v]) => [Number(k), v]));
    this.regions = new Map(Object.entries(raw.regions).map(([k, v]) => [Number(k), v]));
    this.systems = raw.systems.map(([id, name, security, regionId, neighbours]) => ({ id, name, security, regionId, neighbours }));
    for (const s of this.systems) this.systemById.set(s.id, s);
    this.hubs = raw.hubs;
  }

  name(typeId: number): string {
    return this.types[typeId]?.[0] ?? `Type ${typeId}`;
  }

  volume(typeId: number): number {
    return this.types[typeId]?.[1] ?? 0;
  }

  portionSize(typeId: number): number {
    return this.types[typeId]?.[2] ?? 1;
  }
}

export async function loadSde(url = `${import.meta.env.BASE_URL}data/sde.json`): Promise<Sde> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load static data (${res.status}). Run "npm run data" first.`);
  return new Sde(await res.json());
}

/** EVE's displayed security status is rounded to one decimal, with 0.0 < sec < 0.05 shown as 0.1. */
export function displaySecurity(sec: number): number {
  if (sec > 0 && sec < 0.05) return 0.1;
  return Math.round(sec * 10) / 10;
}

export type SecurityClass = "high" | "low" | "null";

export function securityClass(sec: number): SecurityClass {
  const d = displaySecurity(sec);
  if (d >= 0.5) return "high";
  if (d > 0) return "low";
  return "null";
}
