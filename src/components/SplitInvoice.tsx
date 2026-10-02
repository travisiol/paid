import { useId } from "react";
import type { CSSProperties } from "react";
import { formatUsd } from "@/core/split";

/**
 * The brand object: a paper invoice torn along a perforation into the dollar
 * part and the stock part. Built from HTML, CSS and SVG — the amounts are
 * real text, the paper is a generated path with a noise texture.
 *
 * "wide" is the horizontal hero composition (sized in cqw, so it scales with
 * its container). "stacked" is two proportional pieces on top of each other,
 * for phones and narrow columns. "auto" shows stacked below 640px.
 */

export interface SplitInvoiceProps {
  number: string;
  description: string;
  totalCents: number;
  usdgCents: number;
  stockCents: number;
  stockPercent: number;
  /** What the stock part is paid in: a ticker, or "stock" for several destinations. */
  stockLabel: string;
  /** Per-destination amounts, listed on the stock piece when there are several. */
  breakdown?: { label: string; cents: number }[];
  layout?: "auto" | "wide" | "stacked";
  stamp?: boolean;
  /** Pieces part once on load. */
  animate?: boolean;
}

const INK = "#482b38";
const PAPER = "#fffcf5";
const ACCENT = "#b8c4ff";

/* Deterministic jitter: the same seed draws the same torn edge on server and client. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n2 = (value: number) => Math.round(value * 100) / 100;

/** Outline of one piece, with slightly irregular half-round perforation notches on one side. */
function piecePath(w: number, h: number, edge: "left" | "right", seed: number): string {
  const rand = rng(seed);
  const jitter = (amount: number) => (rand() * 2 - 1) * amount;
  const pitch = 10.4;
  const count = Math.floor((h - 6) / pitch);
  const first = (h - count * pitch) / 2 + pitch / 2;
  const notches = Array.from({ length: count }, (_, i) => ({
    cy: first + i * pitch + jitter(0.55),
    r: 3.1 + jitter(0.5),
    dx: jitter(0.7),
  }));
  if (edge === "right") {
    let d = `M0 0L${w} 0`;
    for (const { cy, r, dx } of notches) d += `L${n2(w + dx)} ${n2(cy - r)}A${n2(r)} ${n2(r)} 0 0 0 ${n2(w + dx)} ${n2(cy + r)}`;
    return `${d}L${w} ${h}L0 ${h}Z`;
  }
  let d = `M0 0L${w} 0L${w} ${h}L0 ${h}`;
  for (const { cy, r, dx } of notches.reverse()) d += `L${n2(dx)} ${n2(cy + r)}A${n2(r)} ${n2(r)} 0 0 0 ${n2(dx)} ${n2(cy - r)}`;
  return `${d}Z`;
}

/** Grain, fibres and a soft light across the sheet. Fills its parent. */
function PaperTexture({ id, seed }: { id: string; seed: number }) {
  return (
    <>
      <defs>
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed={seed} />
          <feColorMatrix values="0 0 0 0 0.28  0 0 0 0 0.17  0 0 0 0 0.22  0.4 0 0 0 -0.165" />
        </filter>
        <filter id={`${id}-fibre`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.11" numOctaves="2" seed={seed + 7} />
          <feColorMatrix values="0 0 0 0 0.28  0 0 0 0 0.17  0 0 0 0 0.22  0.2 0 0 0 -0.09" />
        </filter>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.72" stopColor={INK} stopOpacity="0" />
          <stop offset="1" stopColor={INK} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" filter={`url(#${id}-fibre)`} />
      <rect width="100%" height="100%" filter={`url(#${id}-grain)`} />
      <rect width="100%" height="100%" fill={`url(#${id}-light)`} />
    </>
  );
}

function PaperSheet({ id, w, h, edge, fill, seed }: { id: string; w: number; h: number; edge: "left" | "right"; fill: string; seed: number }) {
  const d = piecePath(w, h, edge, seed);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 size-full" aria-hidden="true">
      <clipPath id={`${id}-clip`}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={fill} />
      <g clipPath={`url(#${id}-clip)`}>
        <PaperTexture id={id} seed={seed} />
      </g>
    </svg>
  );
}

/** A round rubber stamp with uneven ink. Decorative. */
function Stamp({ id, className, style }: { id: string; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 120 120" className={className} style={style} aria-hidden="true">
      <defs>
        <filter id={`${id}-ink`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="11" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.2" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="5" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  5.2 0 0 0 -1.75" result="specks" />
          <feComposite in="rough" in2="specks" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${id}-ink)`} fill="none" stroke="#8c2740" transform="rotate(-14 60 60)">
        <circle cx="60" cy="60" r="52" strokeWidth="3.4" />
        <circle cx="60" cy="60" r="44.5" strokeWidth="1.3" />
        <text
          x="60"
          y="71"
          textAnchor="middle"
          fill="#8c2740"
          stroke="none"
          fontSize="31"
          fontWeight="900"
          letterSpacing="1.5"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          PAID
        </text>
      </g>
    </svg>
  );
}

/** Largest size (in the given unit) at which `text` fits `width`, capped at `max`. */
function fit(text: string, width: number, max: number): number {
  return n2(Math.min(max, width / (text.length * 0.6)));
}

function Wide(props: SplitInvoiceProps & { id: string }) {
  const { id, number, description, totalCents, usdgCents, stockCents, stockPercent, stockLabel, stamp, animate } = props;
  // Geometry in cqw (1 unit = 1% of the container width).
  const H = 34;
  const GAP = 1.1;
  const W = 93.6;
  const wR = n2((W - GAP) * 0.2);
  const wL = n2(W - GAP - wR);
  const rL = 3;
  const rR = 4.4;
  const rad = (rL * Math.PI) / 180;
  const xL = 2.4;
  const yL = 0.8;
  const x0 = n2(xL + wL * Math.cos(rad));
  const y0 = n2(yL + wL * Math.sin(rad));
  const stage = n2(y0 + 0.9 + wR * Math.sin((rR * Math.PI) / 180) + H + 3.6);

  const usdg = formatUsd(usdgCents);
  const stock = formatUsd(stockCents);
  const cqw = (value: number) => `${value}cqw`;
  const vars = (v: Record<string, string>) => v as CSSProperties;

  return (
    <div className="inv-stage" style={vars({ "--stage": cqw(stage) })}>
      {/* Dollar piece */}
      <div className="inv-piece" style={vars({ "--x": cqw(xL), "--y": cqw(yL), "--r": `${rL}deg`, width: cqw(wL), height: cqw(H) })}>
        <span className="inv-lift inv-lift--left" aria-hidden="true" />
        <PaperSheet id={`${id}-l`} w={wL * 10} h={H * 10} edge="right" fill={PAPER} seed={3} />
        <div className="absolute inset-0 flex flex-col" style={{ padding: "2.7cqw 4.4cqw 2.4cqw 5.2cqw" }}>
          <div className="flex items-start justify-between" style={{ gap: "2cqw" }}>
            <div className="min-w-0">
              <p className="inv-meta-lg">Invoice {number}</p>
              <p className="inv-meta truncate">{description}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="inv-meta">Total</p>
              <p className="inv-meta-lg">{formatUsd(totalCents)}</p>
            </div>
          </div>
          <hr className="inv-rule" style={{ marginTop: "1.3cqw" }} />
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="inv-amount" style={{ fontSize: cqw(fit(usdg, wL * 0.62, 7.4)) }}>
              {usdg}
            </p>
            <p className="inv-meta-lg" style={{ marginTop: "0.9cqw" }}>
              Paid in dollars
            </p>
            <p className="inv-meta" style={{ marginTop: "1.1cqw", fontSize: "1.8cqw" }}>
              {100 - stockPercent}%
            </p>
          </div>
        </div>
        {stamp && <Stamp id={id} className="absolute" style={{ left: "3.2cqw", bottom: "2.2cqw", width: "10.5cqw", height: "10.5cqw" }} />}
      </div>

      {/* Stock piece */}
      <div
        className={`inv-piece ${animate ? "inv-piece--animate" : ""}`}
        style={vars({
          "--x": cqw(n2(x0 + GAP + 0.3)),
          "--y": cqw(n2(y0 + 0.9)),
          "--r": `${rR}deg`,
          "--x0": cqw(x0),
          "--y0": cqw(y0),
          "--r0": `${rL}deg`,
          width: cqw(wR),
          height: cqw(H),
        })}
      >
        <span className="inv-lift inv-lift--right" aria-hidden="true" />
        <PaperSheet id={`${id}-r`} w={wR * 10} h={H * 10} edge="left" fill={ACCENT} seed={9} />
        <div className="absolute inset-0 flex flex-col text-center" style={{ padding: "2.7cqw 1.5cqw 2.4cqw 1.9cqw" }}>
          <hr className="inv-rule" style={{ marginTop: "7.6cqw" }} />
          <div className="flex flex-1 flex-col items-center justify-center">
            <p className="inv-amount" style={{ fontSize: cqw(fit(stock, wR * 0.8, 4.4)) }}>
              {stock}
            </p>
            <p className="inv-meta" style={{ marginTop: "0.9cqw", fontSize: cqw(fit(`Paid in ${stockLabel}`, wR * 0.8, 1.9)) }}>
              Paid in {stockLabel}
            </p>
            <p className="inv-meta" style={{ marginTop: "1.1cqw", fontSize: "1.8cqw" }}>
              {stockPercent}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stacked(props: SplitInvoiceProps & { id: string }) {
  const { id, number, description, totalCents, usdgCents, stockCents, stockPercent, stockLabel, breakdown, stamp, animate } = props;
  const usdgPercent = 100 - stockPercent;
  const usdg = formatUsd(usdgCents);
  const stock = formatUsd(stockCents);
  return (
    <div className="mx-auto w-full max-w-[440px] px-1 pb-4">
      <div className="tk-piece" style={{ transform: "rotate(-0.8deg)" }}>
        <div className="tk-body tk-body--top bg-paper" style={{ minHeight: `${150 + usdgPercent * 1.1}px` }}>
          <svg className="absolute inset-0 size-full" aria-hidden="true">
            <PaperTexture id={`${id}-t`} seed={3} />
          </svg>
          <div className="relative flex h-full flex-col px-5 pt-5 pb-7" style={{ minHeight: "inherit" }}>
            <div className="mono flex items-start justify-between gap-4 text-[13px] leading-snug">
              <div className="min-w-0">
                <p className="text-[15px] font-medium">Invoice {number}</p>
                <p className="truncate">{description}</p>
              </div>
              <div className="shrink-0 text-right">
                <p>Total</p>
                <p className="text-[15px] font-medium">{formatUsd(totalCents)}</p>
              </div>
            </div>
            <hr className="mt-3 border-0 border-t border-ink/70" />
            <div className="flex flex-1 flex-col items-center justify-center pt-4 text-center">
              <p className="inv-amount" style={{ fontSize: `${fit(usdg, 300, 46)}px` }}>
                {usdg}
              </p>
              <p className="mono mt-2 text-[15px] font-medium">Paid in dollars</p>
              <p className="mono mt-1 text-[14px]">{usdgPercent}%</p>
            </div>
            {stamp && <Stamp id={`${id}-s`} className="absolute bottom-4 left-3 size-[68px]" />}
          </div>
        </div>
      </div>
      <div className={`tk-piece ${animate ? "tk-piece--animate" : ""}`} style={{ transform: "translateY(5px) rotate(0.9deg)" }}>
        <div className="tk-body tk-body--bottom bg-accent" style={{ minHeight: `${104 + stockPercent * 1.1}px` }}>
          <svg className="absolute inset-0 size-full" aria-hidden="true">
            <PaperTexture id={`${id}-b`} seed={9} />
          </svg>
          <div className="relative flex flex-col items-center justify-center px-5 pt-7 pb-5 text-center" style={{ minHeight: "inherit" }}>
            <p className="inv-amount" style={{ fontSize: `${fit(stock, 260, 36)}px` }}>
              {stock}
            </p>
            <p className="mono mt-2 text-[15px] font-medium">Paid in {stockLabel}</p>
            <p className="mono mt-1 text-[14px]">{stockPercent}%</p>
            {breakdown && breakdown.length > 1 && (
              <ul className="mono mt-4 w-full max-w-[260px] border-t border-ink/50 pt-3 text-[13px]">
                {breakdown.map((line) => (
                  <li key={line.label} className="flex justify-between gap-4 py-0.5">
                    <span>{line.label}</span>
                    <span>{formatUsd(line.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SplitInvoice(props: SplitInvoiceProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const layout = props.layout ?? "auto";
  if (layout === "stacked") return <Stacked {...props} id={id} />;
  if (layout === "wide")
    return (
      <div className="inv">
        <Wide {...props} id={id} />
      </div>
    );
  return (
    <>
      <div className="inv hidden sm:block">
        <Wide {...props} id={`${id}w`} />
      </div>
      <div className="sm:hidden">
        <Stacked {...props} id={`${id}s`} />
      </div>
    </>
  );
}
