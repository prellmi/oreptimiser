import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

export function Section(props: { title: string; children: ComponentChildren; hint?: ComponentChildren }) {
  return (
    <section class="panel">
      <h2>{props.title}</h2>
      {props.hint && <p class="hint">{props.hint}</p>}
      {props.children}
    </section>
  );
}

export function Field(props: { label: string; children: ComponentChildren; title?: string }) {
  return (
    <label class="field" title={props.title}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function NumberInput(props: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      onChange={(e) => {
        let v = Number((e.target as HTMLInputElement).value);
        if (!Number.isFinite(v)) return;
        if (props.min != null) v = Math.max(props.min, v);
        if (props.max != null) v = Math.min(props.max, v);
        props.onChange(v);
      }}
    />
  );
}

export function Select<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={String(props.value)}
      disabled={props.disabled}
      onChange={(e) => {
        const raw = (e.target as HTMLSelectElement).value;
        const opt = props.options.find((o) => String(o.value) === raw);
        if (opt) props.onChange(opt.value);
      }}
    >
      {props.options.map((o) => (
        <option value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
}

export function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label class="check" title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      {props.label}
    </label>
  );
}

export const RIG_OPTIONS = [
  { value: 0 as const, label: "No rig" },
  { value: 1 as const, label: "T1 rig" },
  { value: 2 as const, label: "T2 rig" },
];

export const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));

/** Text input with a suggestion dropdown. */
export function Autocomplete<T>(props: {
  placeholder: string;
  selectedLabel: string;
  search: (query: string) => T[];
  render: (item: T) => ComponentChildren;
  onSelect: (item: T) => void;
}) {
  const [query, setQuery] = useState(props.selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(props.selectedLabel), [props.selectedLabel]);
  const results = useMemo(() => (open && query.trim().length >= 2 ? props.search(query.trim()) : []), [open, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(props.selectedLabel);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [props.selectedLabel]);

  const choose = (item: T) => {
    props.onSelect(item);
    setOpen(false);
  };

  return (
    <div class="autocomplete" ref={box}>
      <input
        type="search"
        value={query}
        placeholder={props.placeholder}
        onFocus={(e) => {
          setOpen(true);
          (e.target as HTMLInputElement).select();
        }}
        onInput={(e) => {
          setQuery((e.target as HTMLInputElement).value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && results[active]) choose(results[active]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {results.length > 0 && (
        <ul class="suggestions">
          {results.map((r, i) => (
            <li class={i === active ? "active" : ""} onMouseDown={(e) => (e.preventDefault(), choose(r))}>
              {props.render(r)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
