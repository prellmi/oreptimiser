import { useState } from "preact/hooks";
import type { Sde } from "../data/sde";
import type { BuildPlan } from "../core/industry";
import type { OptimizeResult } from "../core/optimizer";
import type { PlanResult } from "../core/plan";
import type { Settings } from "../core/settings";
import { Section } from "./fields";
import { dec, int, isk, iskFull, m3 } from "./format";

interface Props {
  sde: Sde;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function BuildTree(props: Props & { plan: BuildPlan; result: PlanResult | null }) {
  const { sde, settings: s, update, plan, result } = props;
  const toggleBuy = (typeId: number) =>
    update({
      buyInstead: s.buyInstead.includes(typeId) ? s.buyInstead.filter((t) => t !== typeId) : [...s.buyInstead, typeId],
    });
  return (
    <Section
      title="Build tree"
      hint="Jobs needed to build the item. Components are built by default – switch any of them to “buy” to purchase it instead."
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th class="num">Runs</th>
              <th class="num">Needed / produced</th>
              <th class="num">ME</th>
              <th class="num">Job cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plan.steps.map((step) => {
              const root = step.typeId === s.productId;
              const reaction = step.blueprint.activity === "reaction";
              return (
                <tr>
                  <td style={{ paddingLeft: `${0.5 + step.depth * 1.2}rem` }}>
                    {sde.name(step.typeId)} {reaction && <small>reaction</small>}
                  </td>
                  <td class="num">{int(step.runs)}</td>
                  <td class="num">
                    {int(step.needed)} / {int(step.produced)}
                  </td>
                  <td class="num">
                    {root || reaction ? (
                      reaction ? "–" : step.me
                    ) : (
                      <input
                        class="tiny"
                        type="number"
                        min={0}
                        max={10}
                        value={step.me}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(10, Number((e.target as HTMLInputElement).value) || 0));
                          update({ meOverrides: { ...s.meOverrides, [step.typeId]: v } });
                        }}
                      />
                    )}
                  </td>
                  <td class="num" title={iskFull(result?.jobCosts.get(step.typeId))}>
                    {result ? isk(result.jobCosts.get(step.typeId)) : "–"}
                  </td>
                  <td>{!root && <button class="link" onClick={() => toggleBuy(step.typeId)}>buy instead</button>}</td>
                </tr>
              );
            })}
          </tbody>
          {result && (
            <tfoot>
              <tr>
                <td colSpan={4}>
                  Total installation cost
                  {result.indices && (
                    <small>
                      {" "}
                      (cost index {(result.indices.manufacturing * 100).toFixed(2)}% manufacturing
                      {s.expandReactions && `, ${(result.indices.reaction * 100).toFixed(2)}% reaction`})
                    </small>
                  )}
                  {!s.buildSystemId && <small> (no build system selected – cost index 0)</small>}
                </td>
                <td class="num" title={iskFull(result.totalJobCost)}>{isk(result.totalJobCost)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {s.buyInstead.length > 0 && (
        <p class="hint">
          Bought instead of built:{" "}
          {s.buyInstead.map((t) => (
            <button class="chip" onClick={() => toggleBuy(t)} title="Build this item again">
              {sde.name(t)} ✕
            </button>
          ))}
        </p>
      )}
    </Section>
  );
}

export function RawMaterials(props: Props & { plan: BuildPlan; result: PlanResult | null }) {
  const { sde, plan, result } = props;
  const rows = [...plan.leaves].sort((a, b) => sde.name(a[0]).localeCompare(sde.name(b[0])));
  const fromOre = (t: number) => result?.oreRequirements.has(t);
  return (
    <Section title="Raw materials">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th class="num">Quantity</th>
              <th>Source</th>
              <th class="num">Hub price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([typeId, qty]) => (
              <tr>
                <td>{sde.name(typeId)}</td>
                <td class="num">{int(qty)}</td>
                <td>{result ? (fromOre(typeId) ? <span class="tag ore">ore</span> : <span class="tag buy">buy</span>) : ""}</td>
                <td class="num">{result?.materialPrices.has(typeId) ? isk(result.materialPrices.get(typeId)) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function multibuy(sde: Sde, plan: OptimizeResult, others: PlanResult["otherMaterials"], includeOthers: boolean): string {
  const lines = plan.purchases.map((p) => `${sde.name(p.oreId)}\t${p.units}`);
  if (includeOthers) lines.push(...others.map((o) => `${sde.name(o.typeId)}\t${o.qty}`));
  return lines.join("\n");
}

export function OrePlans(props: Props & { result: PlanResult }) {
  const { sde, settings: s, update, result } = props;
  const [which, setWhich] = useState<"volume" | "cost">("volume");
  const [copied, setCopied] = useState(false);
  const [withOthers, setWithOthers] = useState(true);
  const plan = which === "volume" ? result.volumePlan : result.costPlan;
  const othersCost = result.otherMaterials.reduce((sum, o) => sum + (o.cost ?? 0), 0);
  const othersVolume = result.otherMaterials.reduce((sum, o) => sum + o.volume, 0);
  const missingPrices = result.otherMaterials.filter((o) => o.cost == null);

  const card = (key: "volume" | "cost", title: string, r: OptimizeResult) => (
    <button class={`plan-card ${which === key ? "selected" : ""}`} onClick={() => setWhich(key)}>
      <span class="plan-title">{title}</span>
      {r.status === "optimal" ? (
        <>
          <span class="plan-value">{m3(r.totalVolume)}</span>
          <span class="plan-value">{isk(r.totalCost)}</span>
          <span class="plan-sub">{r.purchases.length} ore types</span>
        </>
      ) : (
        <span class="plan-sub error">{r.message ?? r.status}</span>
      )}
    </button>
  );

  return (
    <Section title={`Ore purchase plan · ${sde.systemById.get(result.hub.systemId)?.name ?? ""}`}>
      <div class="plan-cards">
        {card("volume", "Smallest volume", result.volumePlan)}
        {card("cost", s.freightPerM3 > 0 ? `Cheapest (incl. ${int(s.freightPerM3)} ISK/m³ freight)` : "Cheapest", result.costPlan)}
      </div>

      {plan.uncovered.length > 0 && (
        <p class="hint warn">
          No ore on sale at the hub yields: {plan.uncovered.map((t) => sde.name(t)).join(", ")}. Enable more ore types or buy
          these materials directly.
        </p>
      )}

      {plan.status === "optimal" && plan.purchases.length > 0 && (
        <>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ore</th>
                  <th class="num">Units</th>
                  <th class="num">Volume</th>
                  <th class="num">Cost</th>
                  <th class="num">Avg / unit</th>
                  <th class="num">Yield</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plan.purchases.map((p) => (
                  <tr>
                    <td>{sde.name(p.oreId)}</td>
                    <td class="num">{int(p.units)}</td>
                    <td class="num">{m3(p.volume)}</td>
                    <td class="num" title={iskFull(p.cost)}>{isk(p.cost)}</td>
                    <td class="num">{p.cost != null ? dec(p.cost / p.units) : "–"}</td>
                    <td class="num">{((result.yields.get(p.oreId) ?? 0) * 100).toFixed(1)}%</td>
                    <td>
                      <button
                        class="link"
                        title="Exclude this ore and recalculate"
                        onClick={() => update({ excludedOres: [...s.excludedOres, p.oreId] })}
                      >
                        exclude
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Ores total</td>
                  <td class="num">{m3(plan.totalVolume)}</td>
                  <td class="num" title={iskFull(plan.totalCost)}>{isk(plan.totalCost)}</td>
                  <td colSpan={3}></td>
                </tr>
                {result.otherMaterials.length > 0 && (
                  <tr>
                    <td colSpan={2}>+ other materials at hub</td>
                    <td class="num">{m3(othersVolume)}</td>
                    <td class="num">{isk(othersCost)}</td>
                    <td colSpan={3}></td>
                  </tr>
                )}
                <tr>
                  <td colSpan={2}>+ installation cost</td>
                  <td></td>
                  <td class="num">{isk(result.totalJobCost)}</td>
                  <td colSpan={3}></td>
                </tr>
                <tr class="grand">
                  <td colSpan={2}>Total</td>
                  <td class="num">{m3(plan.totalVolume + othersVolume)}</td>
                  <td class="num" title={iskFull((plan.totalCost ?? 0) + othersCost + result.totalJobCost)}>
                    {isk((plan.totalCost ?? 0) + othersCost + result.totalJobCost)}
                  </td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div class="row wrap">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(multibuy(sde, plan, result.otherMaterials, withOthers));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied!" : "Copy multibuy list"}
            </button>
            {result.otherMaterials.length > 0 && (
              <label class="check">
                <input type="checkbox" checked={withOthers} onChange={(e) => setWithOthers((e.target as HTMLInputElement).checked)} />
                include other materials
              </label>
            )}
          </div>
          {missingPrices.length > 0 && (
            <p class="hint warn">
              Not available at the hub: {missingPrices.map((o) => sde.name(o.typeId)).join(", ")}
            </p>
          )}

          <h3>Reprocessing result</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th class="num">Needed</th>
                  <th class="num">Received</th>
                  <th class="num">Surplus</th>
                  <th class="num">Surplus value</th>
                </tr>
              </thead>
              <tbody>
                {[...plan.output]
                  .sort((a, b) => (result.oreRequirements.has(b[0]) ? 1 : 0) - (result.oreRequirements.has(a[0]) ? 1 : 0) || b[1] - a[1])
                  .map(([typeId, got]) => {
                    const need = result.oreRequirements.get(typeId) ?? 0;
                    const surplus = got - need;
                    const price = result.materialPrices.get(typeId);
                    return (
                      <tr class={need ? "" : "muted"}>
                        <td>{sde.name(typeId)}</td>
                        <td class="num">{need ? int(need) : "–"}</td>
                        <td class="num">{int(got)}</td>
                        <td class="num">{int(surplus)}</td>
                        <td class="num">{price != null ? isk(surplus * price) : "–"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {result.otherMaterials.length > 0 && (
        <>
          <h3>Other materials (not obtainable from the selected ores)</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th class="num">Quantity</th>
                  <th class="num">Volume</th>
                  <th class="num">Cost at hub</th>
                </tr>
              </thead>
              <tbody>
                {result.otherMaterials.map((o) => (
                  <tr>
                    <td>{sde.name(o.typeId)}</td>
                    <td class="num">{int(o.qty)}</td>
                    <td class="num">{m3(o.volume)}</td>
                    <td class="num" title={iskFull(o.cost)}>{isk(o.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
