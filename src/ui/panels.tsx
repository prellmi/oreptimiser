import { useMemo, useState } from "preact/hooks";
import { displaySecurity, securityClass, type OreKind, type Sde, type SolarSystem } from "../data/sde";
import { grossYield } from "../core/reprocessing";
import { candidateOres, industrySettings, reprocessingSettings } from "../core/plan";
import { BUILD_STRUCTURES, DEFAULT_SETTINGS, normalise, shareLink, type BuildStructure, type Settings } from "../core/settings";
import { Autocomplete, Check, Field, LEVEL_OPTIONS, NumberInput, RIG_OPTIONS, Section, Select } from "./fields";
import { pct } from "./format";

export interface PanelProps {
  sde: Sde;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function SecurityBadge(props: { security: number }) {
  const d = displaySecurity(props.security);
  return <span class={`sec sec-${securityClass(props.security)}`}>{d.toFixed(1)}</span>;
}

export function SystemPicker(props: { sde: Sde; value: number | null; onChange: (id: number) => void; placeholder?: string }) {
  const { sde } = props;
  const selected = props.value ? sde.systemById.get(props.value) : undefined;
  return (
    <Autocomplete<SolarSystem>
      placeholder={props.placeholder ?? "Solar system…"}
      selectedLabel={selected?.name ?? ""}
      search={(q) => {
        const lq = q.toLowerCase();
        const starts = sde.systems.filter((s) => s.name.toLowerCase().startsWith(lq));
        const contains = sde.systems.filter((s) => !s.name.toLowerCase().startsWith(lq) && s.name.toLowerCase().includes(lq));
        return [...starts, ...contains].slice(0, 12);
      }}
      render={(s) => (
        <>
          <SecurityBadge security={s.security} /> {s.name} <small>{sde.regions.get(s.regionId)}</small>
        </>
      )}
      onSelect={(s) => props.onChange(s.id)}
    />
  );
}

export function BlueprintPanel({ sde, settings: s, update }: PanelProps) {
  const products = useMemo(
    () =>
      sde.blueprints
        .map((b) => ({ typeId: b.product, name: sde.name(b.product), reaction: b.activity === "reaction" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sde],
  );
  const bp = s.productId ? sde.blueprintByProduct.get(s.productId) : undefined;
  return (
    <Section title="Blueprint">
      <Field label="Item to build">
        <Autocomplete
          placeholder="Search item or blueprint, e.g. Rifter"
          selectedLabel={s.productId ? sde.name(s.productId) : ""}
          search={(q) => {
            const lq = q.toLowerCase().replace(/\s*(blueprint|reaction formula)\s*$/, "");
            const starts = products.filter((p) => p.name.toLowerCase().startsWith(lq));
            const contains = products.filter((p) => !p.name.toLowerCase().startsWith(lq) && p.name.toLowerCase().includes(lq));
            return [...starts, ...contains].slice(0, 15);
          }}
          render={(p) => (
            <>
              {p.name} {p.reaction && <small>reaction</small>}
            </>
          )}
          onSelect={(p) => update({ productId: p.typeId, meOverrides: {}, buyInstead: [] })}
        />
      </Field>
      <div class="row">
        <Field label="Runs">
          <NumberInput value={s.runs} min={1} onChange={(runs) => update({ runs })} />
        </Field>
        <Field label="Blueprint ME">
          <NumberInput value={s.blueprintMe} min={0} max={10} onChange={(blueprintMe) => update({ blueprintMe })} />
        </Field>
        <Field label="Component ME" title="ME assumed for blueprints of intermediate components (can be changed per item in the build tree)">
          <NumberInput value={s.componentMe} min={0} max={10} onChange={(componentMe) => update({ componentMe })} />
        </Field>
      </div>
      {bp && (
        <p class="hint">
          Produces {bp.productQty} × {sde.name(bp.product)} per run
          {bp.maxRuns > 0 && ` · max ${bp.maxRuns} runs per job`}
        </p>
      )}
      <Check
        label="Also build reaction products (composites, intermediates)"
        checked={s.expandReactions}
        onChange={(expandReactions) => update({ expandReactions })}
        title="Expands reaction formulas so their inputs (moon materials, fuel blocks…) become requirements. Enable moon ores / ice in the market section to source them from ore."
      />
    </Section>
  );
}

export function ManufacturingPanel({ sde, settings: s, update }: PanelProps) {
  const sys = s.buildSystemId ? sde.systemById.get(s.buildSystemId) : undefined;
  const ind = industrySettings(sde, s);
  return (
    <Section title="Manufacturing facility">
      <Field label="Build system">
        <SystemPicker sde={sde} value={s.buildSystemId} onChange={(buildSystemId) => update({ buildSystemId })} />
      </Field>
      <div class="row">
        <Field label="Structure">
          <Select<BuildStructure>
            value={s.buildStructure}
            options={Object.entries(BUILD_STRUCTURES).map(([value, v]) => ({ value: value as BuildStructure, label: v.label }))}
            onChange={(buildStructure) => update({ buildStructure })}
          />
        </Field>
        <Field label="ME rig">
          <Select value={s.buildRig} options={RIG_OPTIONS} disabled={s.buildStructure === "npc"} onChange={(buildRig) => update({ buildRig })} />
        </Field>
        <Field label="Reaction rig">
          <Select value={s.reactionRig} options={RIG_OPTIONS} onChange={(reactionRig) => update({ reactionRig })} />
        </Field>
      </div>
      <div class="row">
        <Field label="Facility tax %">
          <NumberInput value={s.facilityTaxPct} min={0} step={0.01} onChange={(facilityTaxPct) => update({ facilityTaxPct })} />
        </Field>
        <Field label="SCC surcharge %">
          <NumberInput value={s.sccSurchargePct} min={0} step={0.1} onChange={(sccSurchargePct) => update({ sccSurchargePct })} />
        </Field>
      </div>
      <p class="hint">
        {sys ? <>Security <SecurityBadge security={sys.security} /> · </> : "No system selected (high-sec assumed) · "}
        material bonus: structure {pct(ind.structureMaterialBonus, 1)}, rig {pct(ind.rigMaterialBonus, 2)}
      </p>
    </Section>
  );
}

const KIND_LABEL: Record<OreKind, string> = { ore: "Asteroid ore", moon: "Moon ore", ice: "Ice" };

export function RefineryPanel({ sde, settings: s, update }: PanelProps) {
  const rs = reprocessingSettings(sde, s);
  const sys = s.refineSystemId ? sde.systemById.get(s.refineSystemId) : undefined;
  // One sample ore per processing skill of the enabled ore kinds, to show the resulting yield.
  const skillRows = useMemo(() => {
    const seen = new Map<number, (typeof sde.ores)[number]>();
    for (const o of sde.ores) if (s.oreKinds[o.kind] && !seen.has(o.skillId)) seen.set(o.skillId, o);
    return [...seen.values()].sort((a, b) => (sde.skills.get(a.skillId) ?? "").localeCompare(sde.skills.get(b.skillId) ?? ""));
  }, [sde, s.oreKinds]);
  const npc = s.refineStructure === "npc";

  return (
    <Section title="Refinery">
      <Field label="Refinery system">
        <SystemPicker sde={sde} value={s.refineSystemId} onChange={(refineSystemId) => update({ refineSystemId })} />
      </Field>
      <div class="row">
        <Field label="Structure">
          <Select
            value={s.refineStructure}
            options={[
              { value: "npc", label: "NPC station" },
              { value: "athanor", label: "Athanor" },
              { value: "tatara", label: "Tatara" },
              { value: "other", label: "Other Upwell" },
            ]}
            onChange={(refineStructure) => update({ refineStructure })}
          />
        </Field>
        <Field label="Tax %" title="Reprocessing tax withheld from the output">
          <NumberInput value={s.refineTaxPct} min={0} max={100} step={0.1} onChange={(refineTaxPct) => update({ refineTaxPct })} />
        </Field>
      </div>
      <div class="row">
        {(["ore", "moon", "ice"] as OreKind[]).map((k) => (
          <Field label={`${KIND_LABEL[k]} rig`}>
            <Select
              value={s.refineRigs[k]}
              options={RIG_OPTIONS}
              disabled={npc}
              onChange={(v) => update({ refineRigs: { ...s.refineRigs, [k]: v } })}
            />
          </Field>
        ))}
      </div>
      <div class="row">
        <Field label="Reprocessing">
          <Select value={s.reprocessingSkill} options={LEVEL_OPTIONS} onChange={(reprocessingSkill) => update({ reprocessingSkill })} />
        </Field>
        <Field label="Reproc. Efficiency">
          <Select value={s.efficiencySkill} options={LEVEL_OPTIONS} onChange={(efficiencySkill) => update({ efficiencySkill })} />
        </Field>
        <Field label="Implant">
          <Select
            value={s.implantPct}
            options={[
              { value: 0, label: "None" },
              { value: 1, label: "RX-801 (1%)" },
              { value: 2, label: "RX-802 (2%)" },
              { value: 4, label: "RX-804 (4%)" },
            ]}
            onChange={(implantPct) => update({ implantPct })}
          />
        </Field>
      </div>
      <table class="compact">
        <thead>
          <tr>
            <th>Processing skill</th>
            <th>Level</th>
            <th class="num">Yield</th>
          </tr>
        </thead>
        <tbody>
          {skillRows.map((o) => (
            <tr>
              <td>{sde.skills.get(o.skillId)}</td>
              <td>
                <Select
                  value={s.oreSkills[o.skillId] ?? 0}
                  options={LEVEL_OPTIONS}
                  onChange={(v) => update({ oreSkills: { ...s.oreSkills, [o.skillId]: v } })}
                />
              </td>
              <td class="num">{pct(grossYield(o, rs))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="row">
        <Check
          label="Override yield"
          checked={s.yieldOverridePct != null}
          onChange={(on) => update({ yieldOverridePct: on ? 50 : null })}
          title="Use a fixed yield, e.g. the value shown in the in-game reprocessing window"
        />
        {s.yieldOverridePct != null && (
          <NumberInput value={s.yieldOverridePct} min={0} max={100} step={0.01} onChange={(yieldOverridePct) => update({ yieldOverridePct })} />
        )}
      </div>
      <p class="hint">
        {sys ? <>Security <SecurityBadge security={sys.security} /> (affects rig bonus)</> : "No system selected (high-sec assumed)"}
      </p>
    </Section>
  );
}

export function MarketPanel({ sde, settings: s, update }: PanelProps) {
  const count = candidateOres(sde, s).length;
  return (
    <Section title="Market & optimisation">
      <Field label="Buy ores at">
        <Select
          value={s.hubStationId}
          options={sde.hubs.map((h) => ({ value: h.stationId, label: h.name }))}
          onChange={(hubStationId) => update({ hubStationId })}
        />
      </Field>
      <div class="row wrap">
        {(["ore", "moon", "ice"] as OreKind[]).map((k) => (
          <Check label={KIND_LABEL[k]} checked={s.oreKinds[k]} onChange={(v) => update({ oreKinds: { ...s.oreKinds, [k]: v } })} />
        ))}
      </div>
      <div class="row wrap">
        <Check label="Compressed" checked={s.allowCompressed} onChange={(allowCompressed) => update({ allowCompressed })} />
        <Check label="Uncompressed" checked={s.allowUncompressed} onChange={(allowUncompressed) => update({ allowUncompressed })} />
      </div>
      <div class="row">
        <Field label="Freight ISK/m³" title="Hauling price per m³. Added to the cheapest plan so it accounts for transport cost.">
          <NumberInput value={s.freightPerM3} min={0} step={50} onChange={(freightPerM3) => update({ freightPerM3 })} />
        </Field>
        <Field label="Max cargo m³" title="0 = unlimited. Applies to both plans (ores only).">
          <NumberInput value={s.maxVolume} min={0} step={1000} onChange={(maxVolume) => update({ maxVolume })} />
        </Field>
        <Field
          label="Volume slack %"
          title="The smallest-volume plan may use this much more volume than the absolute minimum if that makes it cheaper. Even 1% often saves a lot of ISK."
        >
          <NumberInput value={s.volumeSlackPct} min={0} max={50} step={0.5} onChange={(volumeSlackPct) => update({ volumeSlackPct })} />
        </Field>
      </div>
      <p class="hint">
        {count} ore types allowed
        {s.excludedOres.length > 0 && (
          <>
            {" · "}
            {s.excludedOres.length} excluded{" "}
            <button class="link" onClick={() => update({ excludedOres: [] })}>
              restore
            </button>
          </>
        )}
      </p>
    </Section>
  );
}

export function SyncPanel({ settings, update }: PanelProps) {
  const [message, setMessage] = useState("");
  const flash = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(""), 3000);
  };
  return (
    <Section title="Settings" hint="Settings are stored in this browser. Use a link or file to move them to another computer.">
      <div class="row wrap">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(shareLink(settings));
            flash("Link copied – open it on the other computer.");
          }}
        >
          Copy settings link
        </button>
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "oreptimiser-settings.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Export file
        </button>
        <label class="button">
          Import file
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (!file) return;
              try {
                update(normalise(JSON.parse(await file.text())));
                flash("Settings imported.");
              } catch {
                flash("That file is not a valid settings export.");
              }
            }}
          />
        </label>
        <button class="subtle" onClick={() => update({ ...DEFAULT_SETTINGS, productId: settings.productId })}>
          Reset
        </button>
      </div>
      {message && <p class="hint">{message}</p>}
    </Section>
  );
}
