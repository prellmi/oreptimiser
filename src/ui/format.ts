const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const int = (v: number) => intFmt.format(v);
export const dec = (v: number) => decFmt.format(v);
export const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
export const m3 = (v: number) => `${v >= 100 ? intFmt.format(v) : decFmt.format(v)} m³`;

/** Compact ISK amount, e.g. 1.23b / 45.6m / 12.3k. */
export function isk(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}b ISK`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}m ISK`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k ISK`;
  return `${v.toFixed(2)} ISK`;
}

export const iskFull = (v: number | undefined) =>
  v == null || !Number.isFinite(v) ? "" : `${decFmt.format(v)} ISK`;
