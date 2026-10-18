// Downloads the official EVE Online Static Data Export (JSONL) and extracts the
// subset the app needs into public/data/sde.json.
//
// Usage: node scripts/build-sde.mjs [--if-missing] [path/to/sde.zip]
//   Without a path the latest SDE is downloaded from developers.eveonline.com.
//   --if-missing skips the work when public/data/sde.json already exists.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

const SDE_URL = "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "sde.json");

const NEEDED = [
  "_sde", "types", "groups", "blueprints", "typeMaterials", "typeDogma",
  "mapSolarSystems", "mapStargates", "mapRegions", "npcStations",
];

// Major trade hubs. Station names are not part of the SDE, so they are listed here.
const HUBS = [
  { stationId: 60003760, name: "Jita IV - Moon 4 - Caldari Navy Assembly Plant" },
  { stationId: 60008494, name: "Amarr VIII (Oris) - Emperor Family Academy" },
  { stationId: 60011866, name: "Dodixie IX - Moon 20 - Federation Navy Assembly Plant" },
  { stationId: 60004588, name: "Rens VI - Moon 8 - Brutor Tribe Treasury" },
  { stationId: 60005686, name: "Hek VIII - Moon 12 - Boundless Creation Factory" },
];

const ATTR_REPROCESSING_SKILL = 790;
const CATEGORY_ASTEROID = 25;

const args = process.argv.slice(2);
if (args.includes("--if-missing") && existsSync(OUT)) {
  console.log(`${OUT} exists, skipping SDE download`);
  process.exit(0);
}

async function loadZip() {
  const arg = args.find((a) => !a.startsWith("--"));
  if (arg) {
    console.log(`Reading ${arg}`);
    return new Uint8Array(readFileSync(arg));
  }
  console.log(`Downloading ${SDE_URL}`);
  const res = await fetch(SDE_URL);
  if (!res.ok) throw new Error(`SDE download failed: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

function parseJsonl(bytes) {
  return strFromU8(bytes).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const zip = await loadZip();
const files = unzipSync(zip, {
  filter: (f) => NEEDED.some((n) => f.name.replace(/^.*\//, "") === `${n}.jsonl`),
});
const sde = {};
for (const [name, bytes] of Object.entries(files)) {
  sde[name.replace(/^.*\//, "").replace(/\.jsonl$/, "")] = parseJsonl(bytes);
}
for (const n of NEEDED) if (!sde[n]) throw new Error(`Missing ${n}.jsonl in SDE archive`);

const en = (n) => (typeof n === "string" ? n : n?.en ?? "");
const typeById = new Map(sde.types.map((t) => [t._key, t]));
const groupById = new Map(sde.groups.map((g) => [g._key, g]));
const isPublished = (id) => typeById.get(id)?.published === true;

const usedTypes = new Set();
const useType = (id) => usedTypes.add(id);

// --- Blueprints (manufacturing + reactions) -----------------------------------
const blueprints = [];
const productSeen = new Set();
// Manufacturing first so a product with both kinds prefers manufacturing.
for (const activity of ["manufacturing", "reaction"]) {
  for (const bp of sde.blueprints) {
    const act = bp.activities?.[activity];
    if (!act?.products?.length || !act.materials?.length) continue;
    if (!isPublished(bp._key)) continue;
    const product = act.products[0];
    if (!isPublished(product.typeID) || productSeen.has(product.typeID)) continue;
    productSeen.add(product.typeID);
    blueprints.push({
      id: bp._key,
      a: activity === "manufacturing" ? "m" : "r",
      p: product.typeID,
      q: product.quantity,
      m: act.materials.map((m) => [m.typeID, m.quantity]),
      max: bp.maxProductionLimit ?? 0,
    });
    useType(bp._key);
    useType(product.typeID);
    act.materials.forEach((m) => useType(m.typeID));
  }
}

// --- Ores (anything in the Asteroid category that reprocesses) ---------------
const typeMaterials = new Map(sde.typeMaterials.map((t) => [t._key, t.materials]));
const dogma = new Map(
  sde.typeDogma.map((t) => [t._key, Object.fromEntries((t.dogmaAttributes ?? []).map((a) => [a.attributeID, a.value]))]),
);
const ores = [];
const skills = {};
for (const t of sde.types) {
  const group = groupById.get(t.groupID);
  if (group?.categoryID !== CATEGORY_ASTEROID || !t.published || !t.marketGroupID) continue;
  const mats = typeMaterials.get(t._key);
  if (!mats?.length) continue;
  const groupName = en(group.name);
  const name = en(t.name);
  const kind = groupName === "Ice" ? "ice" : groupName.includes("Moon Asteroids") ? "moon" : "ore";
  const skill = dogma.get(t._key)?.[ATTR_REPROCESSING_SKILL] ?? 0;
  if (skill) skills[skill] = en(typeById.get(skill)?.name);
  ores.push({
    id: t._key,
    k: kind,
    c: /^(Batch )?Compressed /.test(name) ? 1 : 0,
    g: groupName,
    s: skill,
    y: mats.map((m) => [m.materialTypeID, m.quantity]),
  });
  useType(t._key);
  mats.forEach((m) => useType(m.materialTypeID));
}

// --- Types ---------------------------------------------------------------------
// [name, packaged volume, portion size]
const types = {};
for (const id of usedTypes) {
  const t = typeById.get(id);
  if (!t) continue;
  types[id] = [en(t.name), t.packagedVolume ?? t.volume ?? 0, t.portionSize ?? 1];
}

// --- Map -------------------------------------------------------------------------
const regions = {};
for (const r of sde.mapRegions) regions[r._key] = en(r.name);
const neighbours = new Map();
for (const g of sde.mapStargates) {
  const dest = g.destination?.solarSystemID;
  if (!dest) continue;
  if (!neighbours.has(g.solarSystemID)) neighbours.set(g.solarSystemID, new Set());
  neighbours.get(g.solarSystemID).add(dest);
}
// [id, name, security, regionId, [neighbour ids]]
const systems = sde.mapSolarSystems.map((s) => [
  s._key,
  en(s.name),
  Math.round((s.securityStatus ?? 0) * 1000) / 1000,
  s.regionID,
  [...(neighbours.get(s._key) ?? [])],
]);


const stationById = new Map(sde.npcStations.map((s) => [s._key, s]));
const systemById = new Map(sde.mapSolarSystems.map((s) => [s._key, s]));
const hubs = HUBS.map((h) => {
  const st = stationById.get(h.stationId);
  if (!st) throw new Error(`Hub station ${h.stationId} not found`);
  const sys = systemById.get(st.solarSystemID);
  return { ...h, systemId: st.solarSystemID, regionId: sys.regionID };
});

const meta = sde._sde[0] ?? {};
const out = {
  meta: { build: meta.buildNumber, released: meta.releaseDate, generated: new Date().toISOString() },
  types, blueprints, ores, skills, regions, systems, hubs,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(
  `Wrote ${OUT}: ${blueprints.length} blueprints, ${ores.length} ores, ` +
  `${Object.keys(types).length} types, ${systems.length} systems (SDE build ${meta.buildNumber})`,
);
