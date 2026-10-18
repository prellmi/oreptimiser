# Oreptimiser

EVE Ore Optimiser - a tool to get the best ore combination to build your blueprint.

An EVE Online ore planner. Pick a blueprint and Oreptimiser works out which ores to buy at a trade hub,
haul to your refinery and reprocess, so you get every mineral the full build tree needs. It gives two answers:

- **Smallest volume**: the ore mix with the least m³ to haul (usually compressed ores). Among the
  plans within *Volume slack %* of the minimum it picks the cheapest one.
- **Cheapest**: the lowest ISK cost, walking the real sell-order book (large purchases pay the higher
  orders too). Optionally add a freight rate (ISK/m³) and/or a cargo limit.

It runs entirely in the browser: a static site, no server, no login. Install it as an app (PWA) from
Chrome/Edge to get its own window and icon on each computer.

## Features

- Full build tree: components (T2 parts, capital components, T1 hulls for T2 ships…) are expanded down
  to raw materials. Any component can be switched to "buy instead", and component ME can be set per item.
  Reactions can optionally be expanded too.
- Game-accurate material maths: blueprint ME, structure and rig bonuses with security multipliers, and
  `max(runs, ceil(round(…, 2)))` rounding per job.
- Reprocessing yield: NPC station or Upwell refinery (Athanor/Tatara) with rigs, security bonus, skills,
  per-ore processing skills, implant and tax. The game's per-stack flooring is checked and topped up.
- Ore selection: asteroid ore, moon ore and ice, compressed and/or uncompressed, single ores can be excluded.
- Live market data from ESI for Jita, Amarr, Dodixie, Rens or Hek. Materials no ore can supply
  (PI, reaction products, …) are listed with their hub cost.
- Installation cost per job from the system cost index (ESI), structure bonus, facility tax and SCC surcharge.
- "Find systems": systems with the lowest manufacturing/reaction cost index within N jumps of the hub.
- "Copy multibuy list" for pasting into the in-game multibuy window.
- Settings move between computers via a settings link or export/import file.

## Data sources

| Data | Source |
|---|---|
| Blueprint materials, reprocessing yields, volumes, portion sizes, map | [Static Data Export](https://developers.eveonline.com/static-data) (bundled at build time) |
| Sell orders, adjusted prices, system cost indices | [ESI](https://esi.evetech.net/) (live, cached 5 min) |

ESI itself doesn't provide blueprint materials or reprocessing yields, so those come from the SDE.

## Development

Requires Node.js 20+.

```sh
npm install
npm run dev        # downloads the SDE on first run (~80 MB), then serves on http://localhost:5173
npm test           # unit tests
LIVE=1 npx vitest run test/live.test.ts   # end-to-end check against live ESI
npm run build      # production build in dist/
```

`npm run data` re-downloads the SDE and regenerates `public/data/sde.json` (do this after game patches).
`node scripts/build-sde.mjs path/to/sde.zip` uses an already downloaded archive.

### How the optimiser works

A mixed-integer linear program solved with [HiGHS](https://highs.dev/) (WebAssembly, in a Web Worker):

- variables: portions `x_i` of each ore (integers) and units bought per order-book segment `y_ik`
- constraints: `Σ_i yield_im · efficiency_i · x_i ≥ need_m` for every material, `Σ_k y_ik = portion_i · x_i`,
  `y_ik ≤ units on sale`, optional cargo limit
- objective: volume, or cost (+ freight × volume)

Solutions are within 0.1% of the optimum (MIP gap). Code lives in `src/core/optimizer.ts`; the build
tree is in `src/core/industry.ts`, yields in `src/core/reprocessing.ts`.

## Deploying to GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository settings, set **Pages → Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds with fresh SDE data on every push and
   weekly, then publishes to `https://<user>.github.io/<repo>/`.

Open that URL on any computer. In Chrome or Edge, use the install icon in the address bar to install it as an app.

---

Released under the [MIT License](LICENSE). EVE Online and all related materials are property of CCP Games. This tool is not affiliated with CCP.
