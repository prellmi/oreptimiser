// Minimal EVE Swagger Interface client for the public endpoints used by the app.

import type { PriceLevel } from "./optimizer";

const ESI = "https://esi.evetech.net/latest";
const CACHE_MS = 5 * 60 * 1000;
const CONCURRENCY = 12;

const cache = new Map<string, { at: number; value: unknown }>();

async function getJson<T>(path: string): Promise<{ data: T; pages: number }> {
  const sep = path.includes("?") ? "&" : "?";
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ESI}${path}${sep}datasource=tranquility`);
    if (res.ok) return { data: (await res.json()) as T, pages: Number(res.headers.get("x-pages") ?? 1) };
    // Retry transient errors and rate limiting a few times.
    if (attempt < 3 && (res.status >= 500 || res.status === 420 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`ESI ${path} failed: ${res.status} ${res.statusText}`);
  }
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Runs `fn` over `items` with limited parallelism. */
async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

interface EsiOrder {
  location_id: number;
  price: number;
  volume_remain: number;
  is_buy_order: boolean;
}

/** Sell orders of one type at one station, aggregated per price and sorted cheapest first. */
export async function sellOrders(regionId: number, stationId: number, typeId: number): Promise<PriceLevel[]> {
  return cached(`orders:${regionId}:${stationId}:${typeId}`, async () => {
    const first = await getJson<EsiOrder[]>(`/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}`);
    const all = [...first.data];
    for (let p = 2; p <= first.pages; p++) {
      all.push(...(await getJson<EsiOrder[]>(`/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=${p}`)).data);
    }
    const byPrice = new Map<number, number>();
    for (const o of all) {
      if (o.is_buy_order || o.location_id !== stationId) continue;
      byPrice.set(o.price, (byPrice.get(o.price) ?? 0) + o.volume_remain);
    }
    return [...byPrice].map(([price, units]) => ({ price, units })).sort((a, b) => a.price - b.price);
  });
}

export async function sellOrdersMany(
  regionId: number,
  stationId: number,
  typeIds: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, PriceLevel[]>> {
  const books = await pool(typeIds, (t) => sellOrders(regionId, stationId, t), (d) => onProgress?.(d, typeIds.length));
  return new Map(typeIds.map((t, i) => [t, books[i]]));
}

/** CCP's adjusted prices, used for the estimated item value of industry jobs. */
export async function adjustedPrices(): Promise<Map<number, number>> {
  return cached("prices", async () => {
    const { data } = await getJson<{ type_id: number; adjusted_price?: number }[]>("/markets/prices/");
    return new Map(data.map((p) => [p.type_id, p.adjusted_price ?? 0]));
  });
}

export interface SystemCostIndices {
  manufacturing: number;
  reaction: number;
}

export async function costIndices(): Promise<Map<number, SystemCostIndices>> {
  return cached("indices", async () => {
    const { data } = await getJson<{ solar_system_id: number; cost_indices: { activity: string; cost_index: number }[] }[]>(
      "/industry/systems/",
    );
    return new Map(
      data.map((s) => [
        s.solar_system_id,
        {
          manufacturing: s.cost_indices.find((c) => c.activity === "manufacturing")?.cost_index ?? 0,
          reaction: s.cost_indices.find((c) => c.activity === "reaction")?.cost_index ?? 0,
        },
      ]),
    );
  });
}
