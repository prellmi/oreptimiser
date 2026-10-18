// Ore purchase optimiser.
//
// Mixed-integer program over the number of reprocessing portions x_i of every ore:
//   Σ_i floor-free yield(i, m) · x_i ≥ need(m)        for every required material m
//   volume mode: minimise Σ_i volume_i · x_i, then (if prices are known) the cost among plans at most
//                `volumeSlack` larger than the smallest one
//   cost mode:   minimise Σ_i Σ_k price_ik · y_ik + freight · Σ_i volume_i · x_i
//                with Σ_k y_ik = portionSize_i · x_i and 0 ≤ y_ik ≤ units on order level k
// The game floors reprocessing output per material and stack, so the solution is checked with
// flooring and topped up portion by portion (or re-solved with raised requirements) until it really
// covers everything.
// Order books are merged into a few price segments for the model; reported costs walk the exact book.

export interface PriceLevel {
  price: number;
  units: number;
}

export interface OreOption {
  oreId: number;
  portionSize: number;
  /** m³ of one portion. */
  portionVolume: number;
  /** Materials per portion at 100% yield. */
  yields: { typeId: number; qty: number }[];
  /** Net yield fraction (skills, structure, tax). */
  efficiency: number;
  /** Sell orders at the hub, cheapest first. Undefined = no market data (unlimited, unknown price). */
  orders?: PriceLevel[];
}

export interface OptimizeInput {
  requirements: Map<number, number>;
  options: OreOption[];
  objective: "volume" | "cost";
  /** ISK per m³ added to the cost objective (hauling price). */
  freightPerM3?: number;
  /** Maximum total m³ (cargo hold), optional. */
  maxVolume?: number;
  /** Volume mode: relative extra volume allowed when picking the cheapest of the smallest plans (default 0). */
  volumeSlack?: number;
}

export interface OrePurchase {
  oreId: number;
  portions: number;
  units: number;
  volume: number;
  /** Undefined if no market data. */
  cost?: number;
}

export interface OptimizeResult {
  status: "optimal" | "infeasible" | "error";
  message?: string;
  purchases: OrePurchase[];
  /** Materials received after reprocessing (floored as in game). */
  output: Map<number, number>;
  /** Requirements that no selected ore type yields at all. */
  uncovered: number[];
  totalVolume: number;
  totalCost?: number;
}

export interface HighsSolution {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number }>;
}

/** HiGHS instance, either in-process (sync) or behind a Web Worker (async). */
export interface HighsLike {
  solve(lp: string, options?: Record<string, unknown>): HighsSolution | Promise<HighsSolution>;
}

// A relative gap of 0.1% is below market noise and avoids proving optimality between
// near-identical ore grades, which can take minutes.
const SOLVER_OPTIONS = { output_flag: false, time_limit: 6, mip_rel_gap: 1e-3 };
const MAX_SEGMENTS = 8;

const EPS = 1e-9;

function num(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(12)));
}

/** Total price of buying `units` from the order book, walking from the cheapest order. */
export function costOfUnits(orders: PriceLevel[], units: number): number {
  let left = units;
  let cost = 0;
  for (const o of orders) {
    if (left <= 0) break;
    const take = Math.min(left, o.units);
    cost += take * o.price;
    left -= take;
  }
  return left > 0 ? Infinity : cost;
}

/** Materials received from reprocessing the given portions, floored per ore stack and material. */
export function reprocessOutput(options: OreOption[], portions: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of options) {
    const x = portions.get(o.oreId) ?? 0;
    if (!x) continue;
    for (const y of o.yields) {
      out.set(y.typeId, (out.get(y.typeId) ?? 0) + Math.floor(x * y.qty * o.efficiency + EPS));
    }
  }
  return out;
}

interface Model {
  lp: string;
}

function buildModel(
  req: Map<number, number>,
  opts: OreOption[],
  input: OptimizeInput,
  stage: "volume" | "cost",
  volumeCap?: number,
): Model {
  const useOrders = stage === "cost";
  const objective: string[] = [];
  const rows: string[] = [];
  const bounds: string[] = [];
  const generals: string[] = [];

  for (const o of opts) {
    const x = `x${o.oreId}`;
    generals.push(x);
    const maxPortions = maxUsefulPortions(o, req);
    const available = o.orders ? Math.floor(o.orders.reduce((s, l) => s + l.units, 0) / o.portionSize) : Infinity;
    bounds.push(`0 <= ${x} <= ${Math.min(maxPortions, available)}`);
    if (useOrders) {
      if (input.freightPerM3) objective.push(`+ ${num(input.freightPerM3 * o.portionVolume)} ${x}`);
      const levels = segments(o.orders!, maxPortions * o.portionSize);
      const link = [`- ${o.portionSize} ${x}`];
      levels.forEach((l, k) => {
        const y = `y${o.oreId}_${k}`;
        objective.push(`+ ${num(l.price)} ${y}`);
        bounds.push(`0 <= ${y} <= ${l.units}`);
        link.push(`+ ${y}`);
      });
      rows.push(`l${o.oreId}: ${link.join("\n ")} = 0`);
    } else {
      objective.push(`+ ${num(o.portionVolume)} ${x}`);
    }
  }

  for (const [typeId, need] of req) {
    const terms = opts.flatMap((o) => {
      const y = o.yields.find((v) => v.typeId === typeId);
      return y ? [`+ ${num(y.qty * o.efficiency)} x${o.oreId}`] : [];
    });
    if (terms.length) rows.push(`m${typeId}: ${terms.join("\n ")} >= ${num(need)}`);
  }

  const cap = Math.min(input.maxVolume ?? Infinity, volumeCap ?? Infinity);
  if (Number.isFinite(cap)) {
    rows.push(`vol: ${opts.map((o) => `+ ${num(o.portionVolume)} x${o.oreId}`).join("\n ")} <= ${num(cap)}`);
  }

  const lp = [
    "Minimize",
    ` obj: ${objective.length ? objective.join("\n ") : "0 x0"}`,
    "Subject To",
    ...rows.map((r) => ` ${r}`),
    "Bounds",
    ...bounds.map((b) => ` ${b}`),
    "Generals",
    ` ${generals.join(" ")}`,
    "End",
  ].join("\n");
  return { lp };
}

/** Upper bound on portions of an ore that could ever be useful for the requirements. */
function maxUsefulPortions(o: OreOption, req: Map<number, number>): number {
  let max = 0;
  for (const y of o.yields) {
    const need = req.get(y.typeId);
    if (!need || y.qty * o.efficiency <= 0) continue;
    max = Math.max(max, Math.ceil(need / (y.qty * o.efficiency)) + 1);
  }
  return max;
}

/**
 * Merges the order book (up to the units that could be useful) into at most MAX_SEGMENTS segments
 * with geometrically growing sizes, so small purchases stay precise. Each segment is priced at its
 * average, which keeps the cost curve convex.
 */
export function segments(orders: PriceLevel[], maxUnits: number): PriceLevel[] {
  const book: PriceLevel[] = [];
  let total = 0;
  for (const l of orders) {
    if (total >= maxUnits) break;
    book.push(l);
    total += l.units;
  }
  if (book.length <= MAX_SEGMENTS) return book;
  const out: PriceLevel[] = [];
  let bound = total / 2 ** (MAX_SEGMENTS - 1);
  let units = 0;
  let cost = 0;
  let cumulative = 0;
  for (const l of book) {
    units += l.units;
    cost += l.units * l.price;
    cumulative += l.units;
    if (cumulative >= bound || l === book[book.length - 1]) {
      out.push({ price: cost / units, units });
      units = 0;
      cost = 0;
      while (bound <= cumulative) bound *= 2;
    }
  }
  return out;
}

async function solveOnce(highs: HighsLike, model: Model, timeLimit = SOLVER_OPTIONS.time_limit): Promise<Map<number, number> | string> {
  const prefix = "x";
  let res;
  try {
    res = await highs.solve(model.lp, { ...SOLVER_OPTIONS, time_limit: timeLimit });
  } catch (e) {
    return `Solver error: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (res.Status !== "Optimal" && !(res.Status === "Time limit reached" && Object.keys(res.Columns).length)) {
    return res.Status;
  }
  const portions = new Map<number, number>();
  for (const [name, col] of Object.entries(res.Columns)) {
    if (!name.startsWith(prefix) || name.includes("_")) continue;
    const v = Math.round(col.Primal);
    if (v > 0) portions.set(Number(name.slice(prefix.length)), v);
  }
  return portions;
}

export async function optimize(highs: HighsLike, input: OptimizeInput): Promise<OptimizeResult> {
  // Usable ores: positive yield and, if market data is used, at least one portion on sale.
  const usable = input.options.filter(
    (o) => o.efficiency > 0 && (!o.orders || o.orders.reduce((s, l) => s + l.units, 0) >= o.portionSize),
  );
  const yielded = new Set(usable.flatMap((o) => o.yields.map((y) => y.typeId)));
  const uncovered = [...input.requirements.keys()].filter((t) => !yielded.has(t));
  const req = new Map([...input.requirements].filter(([t, q]) => yielded.has(t) && q > 0));
  const opts = usable.filter((o) => o.yields.some((y) => req.has(y.typeId)));
  const empty: OptimizeResult = { status: "optimal", purchases: [], output: new Map(), uncovered, totalVolume: 0 };
  if (req.size === 0) return empty;
  if (input.objective === "cost" && opts.some((o) => !o.orders)) {
    return { ...empty, status: "error", message: "Cost optimisation needs market data for every ore." };
  }
  const hasPrices = opts.length > 0 && opts.every((o) => o.orders);

  const target = new Map(req);
  let portions: Map<number, number> | string = new Map();
  for (let iteration = 0; iteration < 8; iteration++) {
    if (input.objective === "volume") {
      portions = await solveOnce(highs, buildModel(target, opts, input, "volume"));
      if (typeof portions !== "string" && hasPrices) {
        // Second stage: cheapest plan among those with (practically) the smallest volume.
        const vol = totalVolume(opts, portions);
        // This stage is a hard knapsack-like problem; it only improves the price, so give it a short time budget.
        const cap = vol * (1 + (input.volumeSlack ?? 0)) + 1e-6;
        const cheaper = await solveOnce(highs, buildModel(target, opts, input, "cost", cap), 4);
        if (typeof cheaper !== "string") portions = cheaper;
      }
    } else {
      portions = await solveOnce(highs, buildModel(target, opts, input, "cost"));
    }
    if (typeof portions === "string") break;

    const repaired = topUp(opts, portions, req, input);
    if (repaired) return finish(opts, repaired, reprocessOutput(opts, repaired), uncovered, hasPrices);

    const chosen = portions;
    const output = reprocessOutput(opts, chosen);
    let short = false;
    for (const [typeId, need] of req) {
      const got = output.get(typeId) ?? 0;
      if (got < need) {
        short = true;
        // Flooring loses less than one unit per ore stack, so bump by at least the number of stacks yielding it.
        const stacks = opts.filter((o) => chosen.has(o.oreId) && o.yields.some((y) => y.typeId === typeId)).length;
        target.set(typeId, (target.get(typeId) ?? need) + Math.max(need - got, stacks));
      }
    }
    if (!short) return finish(opts, portions, output, uncovered, hasPrices);
  }

  if (typeof portions === "string") {
    const infeasible = /infeasible/i.test(portions);
    return {
      ...empty,
      status: infeasible ? "infeasible" : "error",
      message: infeasible
        ? "Not enough ore available on the market (or within the cargo limit) to cover the requirements."
        : portions,
    };
  }
  return { ...empty, status: "error", message: "Could not find a plan that covers the rounded reprocessing output." };
}

/**
 * Covers small shortfalls caused by in-game rounding by adding single portions of the ore that
 * delivers the missing material most cheaply (or with the least volume). Returns null if impossible.
 */
function topUp(
  opts: OreOption[],
  solved: Map<number, number>,
  req: Map<number, number>,
  input: OptimizeInput,
): Map<number, number> | null {
  const portions = new Map(solved);
  const available = (o: OreOption) =>
    o.orders ? Math.floor(o.orders.reduce((s, l) => s + l.units, 0) / o.portionSize) : Infinity;
  for (let step = 0; step < 500; step++) {
    const out = reprocessOutput(opts, portions);
    const short = [...req].find(([t, need]) => (out.get(t) ?? 0) < need);
    if (!short) {
      const vol = totalVolume(opts, portions);
      return input.maxVolume != null && vol > input.maxVolume + 1e-6 ? null : portions;
    }
    const [typeId] = short;
    let best: OreOption | null = null;
    let bestScore = Infinity;
    for (const o of opts) {
      const y = o.yields.find((v) => v.typeId === typeId);
      const x = portions.get(o.oreId) ?? 0;
      if (!y || x + 1 > available(o)) continue;
      const perPortion =
        input.objective === "volume" || !o.orders
          ? o.portionVolume
          : costOfUnits(o.orders, (x + 1) * o.portionSize) - costOfUnits(o.orders, x * o.portionSize) +
            (input.freightPerM3 ?? 0) * o.portionVolume;
      const score = perPortion / (y.qty * o.efficiency);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best) return null;
    portions.set(best.oreId, (portions.get(best.oreId) ?? 0) + 1);
  }
  return null;
}

function totalVolume(opts: OreOption[], portions: Map<number, number>): number {
  return opts.reduce((s, o) => s + (portions.get(o.oreId) ?? 0) * o.portionVolume, 0);
}

function finish(
  opts: OreOption[],
  portions: Map<number, number>,
  output: Map<number, number>,
  uncovered: number[],
  hasPrices: boolean,
): OptimizeResult {
  const purchases: OrePurchase[] = [];
  for (const o of opts) {
    const p = portions.get(o.oreId);
    if (!p) continue;
    const units = p * o.portionSize;
    purchases.push({
      oreId: o.oreId,
      portions: p,
      units,
      volume: p * o.portionVolume,
      cost: o.orders ? costOfUnits(o.orders, units) : undefined,
    });
  }
  purchases.sort((a, b) => b.volume - a.volume);
  return {
    status: "optimal",
    purchases,
    output,
    uncovered,
    totalVolume: purchases.reduce((s, p) => s + p.volume, 0),
    totalCost: hasPrices ? purchases.reduce((s, p) => s + (p.cost ?? 0), 0) : undefined,
  };
}
