import { useEffect, useMemo, useState } from "preact/hooks";
import { securityClass, type SecurityClass, type Sde } from "../data/sde";
import { costIndices, type SystemCostIndices } from "../core/esi";
import type { Settings } from "../core/settings";
import { Check, Field, NumberInput, Section, Select } from "./fields";
import { SecurityBadge } from "./panels";

/** Jump distances from one system over the stargate network. */
function jumpsFrom(sde: Sde, start: number): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const n of sde.systemById.get(id)?.neighbours ?? []) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(id)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

export function SystemFinder(props: { sde: Sde; settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const { sde, settings: s, update } = props;
  const [indices, setIndices] = useState<Map<number, SystemCostIndices> | null>(null);
  const [error, setError] = useState("");
  const [sec, setSec] = useState<Record<SecurityClass, boolean>>({ high: true, low: true, null: false });
  const [maxJumps, setMaxJumps] = useState(15);
  const [sortBy, setSortBy] = useState<"manufacturing" | "reaction">("manufacturing");

  useEffect(() => {
    costIndices().then(setIndices, (e) => setError(String(e)));
  }, []);

  const hub = sde.hubs.find((h) => h.stationId === s.hubStationId) ?? sde.hubs[0];
  const jumps = useMemo(() => jumpsFrom(sde, hub.systemId), [sde, hub.systemId]);

  const rows = useMemo(() => {
    if (!indices) return [];
    return [...indices]
      .map(([id, idx]) => ({ sys: sde.systemById.get(id)!, idx, jumps: jumps.get(id) }))
      .filter((r) => r.sys && r.jumps != null && r.jumps <= maxJumps && sec[securityClass(r.sys.security)])
      .filter((r) => r.idx[sortBy] > 0)
      .sort((a, b) => a.idx[sortBy] - b.idx[sortBy] || a.jumps! - b.jumps!)
      .slice(0, 100);
  }, [indices, jumps, maxJumps, sec, sortBy]);

  return (
    <Section
      title="Find a build system"
      hint={`Lowest system cost indices within reach of ${sde.systemById.get(hub.systemId)?.name}. Reprocessing yield depends on the structure you use, so check what refineries are available locally.`}
    >
      <div class="row wrap">
        {(["high", "low", "null"] as SecurityClass[]).map((k) => (
          <Check label={`${k}-sec`} checked={sec[k]} onChange={(v) => setSec({ ...sec, [k]: v })} />
        ))}
        <Field label="Max jumps from hub">
          <NumberInput value={maxJumps} min={0} max={100} onChange={setMaxJumps} />
        </Field>
        <Field label="Sort by">
          <Select
            value={sortBy}
            options={[
              { value: "manufacturing", label: "Manufacturing index" },
              { value: "reaction", label: "Reaction index" },
            ]}
            onChange={setSortBy}
          />
        </Field>
      </div>
      {error && <p class="hint warn">{error}</p>}
      {!indices && !error && <p class="hint">Loading cost indices from ESI…</p>}
      {indices && (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>System</th>
                <th>Region</th>
                <th class="num">Jumps</th>
                <th class="num">Manufacturing</th>
                <th class="num">Reaction</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr>
                  <td>
                    <SecurityBadge security={r.sys.security} /> {r.sys.name}
                  </td>
                  <td>{sde.regions.get(r.sys.regionId)}</td>
                  <td class="num">{r.jumps}</td>
                  <td class="num">{(r.idx.manufacturing * 100).toFixed(2)}%</td>
                  <td class="num">{(r.idx.reaction * 100).toFixed(2)}%</td>
                  <td class="actions">
                    <button class="link" onClick={() => update({ buildSystemId: r.sys.id })}>
                      {s.buildSystemId === r.sys.id ? "✓ build" : "build here"}
                    </button>
                    <button class="link" onClick={() => update({ refineSystemId: r.sys.id })}>
                      {s.refineSystemId === r.sys.id ? "✓ refine" : "refine here"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
