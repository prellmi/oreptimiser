import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadSde, type Sde } from "./data/sde";
import { buildPlan, runPlan, type PlanResult } from "./core/plan";
import { loadSettings, saveSettings, type Settings } from "./core/settings";
import { highs } from "./core/solver";
import { BlueprintPanel, ManufacturingPanel, MarketPanel, RefineryPanel, SyncPanel } from "./ui/panels";
import { BuildTree, OrePlans, RawMaterials } from "./ui/results";
import { SystemFinder } from "./ui/systems";

export function App() {
  const [sde, setSde] = useState<Sde | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTab] = useState<"plan" | "systems">("plan");
  const [result, setResult] = useState<PlanResult | null>(null);
  const [resultFor, setResultFor] = useState<string>("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const autoRerun = useRef(false);

  useEffect(() => {
    loadSde().then(setSde, (e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => saveSettings(settings), [settings]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const plan = useMemo(() => {
    if (!sde) return null;
    try {
      return buildPlan(sde, settings);
    } catch {
      return null;
    }
  }, [sde, settings]);

  const settingsKey = JSON.stringify(settings);
  const stale = result != null && resultFor !== settingsKey;

  const calculate = async () => {
    if (!sde || busy) return;
    setBusy("Starting…");
    setError("");
    try {
      const r = await runPlan(sde, settings, highs, setBusy);
      setResult(r);
      setResultFor(settingsKey);
      autoRerun.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  // After a first calculation, recalculate automatically when settings change (market data is cached for 5 min).
  useEffect(() => {
    if (!autoRerun.current || !stale || busy || !plan) return;
    const t = setTimeout(calculate, 600);
    return () => clearTimeout(t);
  }, [settingsKey, busy]);

  if (loadError) {
    return (
      <main class="center">
        <p class="error">{loadError}</p>
      </main>
    );
  }
  if (!sde) {
    return (
      <main class="center">
        <p>Loading static data…</p>
      </main>
    );
  }

  const props = { sde, settings, update };
  return (
    <>
      <header>
        <h1>
          Oreptimiser <small>EVE Online ore planner</small>
        </h1>
        <nav>
          <button class={tab === "plan" ? "tab active" : "tab"} onClick={() => setTab("plan")}>
            Planner
          </button>
          <button class={tab === "systems" ? "tab active" : "tab"} onClick={() => setTab("systems")}>
            Find systems
          </button>
        </nav>
      </header>
      <div class="layout">
        <aside>
          <BlueprintPanel {...props} />
          <MarketPanel {...props} />
          <RefineryPanel {...props} />
          <ManufacturingPanel {...props} />
          <SyncPanel {...props} />
        </aside>
        <main>
          {tab === "systems" ? (
            <SystemFinder {...props} />
          ) : !plan ? (
            <section class="panel intro">
              <h2>Getting started</h2>
              <ol>
                <li>Search the item you want to build and set runs and ME.</li>
                <li>Pick the trade hub, allowed ore types and your refinery setup.</li>
                <li>
                  Press <b>Calculate</b>: the app loads live sell orders via ESI and finds the ore mix with the
                  <b> smallest cargo volume</b> and the <b>cheapest</b> one.
                </li>
              </ol>
              <p class="hint">Use “Find systems” to locate a nearby system with a low manufacturing cost index.</p>
            </section>
          ) : (
            <>
              <div class="actionbar">
                <button class="primary" onClick={calculate} disabled={!!busy}>
                  {busy ? "Working…" : result ? "Recalculate" : "Calculate"}
                </button>
                <span class="status">
                  {busy || (error ? <span class="error">{error}</span> : stale ? "Settings changed – recalculating soon…" : "")}
                </span>
              </div>
              {result && (
                <div class={stale ? "stale" : ""}>
                  <OrePlans {...props} result={result} />
                </div>
              )}
              <BuildTree {...props} plan={plan} result={result} />
              <RawMaterials {...props} plan={plan} result={result} />
            </>
          )}
        </main>
      </div>
      <footer>
        Static data: SDE build {sde.meta.build} ({sde.meta.released?.slice(0, 10)}) · Market data: EVE Swagger Interface ·
        EVE Online and all related materials are property of CCP Games.
      </footer>
    </>
  );
}
