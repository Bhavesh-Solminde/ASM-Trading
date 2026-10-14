import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../_lib/icons";
import { hrefWith, initials } from "../_lib/format";

/* ------------------------------- Page header ------------------------------- */
export function PageHead({
  title,
  desc,
  back,
  actions,
}: {
  title: string;
  desc?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div>
      {back ? (
        <Link className="admin-back" href={back.href}>
          <Icon name="chevronLeft" size={16} />
          {back.label}
        </Link>
      ) : null}
      <div className="admin-head">
        <div>
          <h1>{title}</h1>
          {desc ? <p>{desc}</p> : null}
        </div>
        {actions ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------- Notice ----------------------------------- */
/** A one-line result message under the page header (saved, failed, created). */
export function Notice({ tone, children }: { tone: "pos" | "neg" | "info"; children: ReactNode }) {
  return (
    <div className={`admin-notice admin-notice--${tone}`} role={tone === "neg" ? "alert" : "status"}>
      <Icon name={tone === "pos" ? "check" : tone === "neg" ? "alert" : "info"} size={16} />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------- Tab bar ----------------------------------- */
/** Underlined, link-based tabs: each tab is a real navigation so the server
 *  component re-renders with fresh data. Counts ride on the tab itself. */
export function TabBar({
  tabs,
  active,
  label,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  active: string;
  label: string;
}) {
  return (
    <nav className="admin-tabbar" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`admin-tab${t.key === active ? " active" : ""}`}
        >
          {t.label}
          {t.count ? <span className="admin-tab__badge">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/* ---------------------------------- Pills ---------------------------------- */
type PillTone = "pos" | "neg" | "warn" | "info" | "muted" | "accent";

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`admin-pill admin-pill--${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, PillTone> = {
  // deposit
  AWAITING_PAYMENT: "muted",
  PENDING_CONFIRMATION: "warn",
  COMPLETED: "pos",
  REJECTED: "neg",
  EXPIRED: "muted",
  // withdrawal
  REQUESTED: "warn",
  APPROVED: "info",
  PAID: "pos",
  HELD: "warn",
  CANCELLED_BY_USER: "muted",
  // kyc
  NOT_STARTED: "muted",
  PENDING: "warn",
  VERIFIED: "pos",
  // ticket
  OPEN: "warn",
  ANSWERED: "info",
  CLOSED: "muted",
  // asset / generic
  ACTIVE: "pos",
  PAUSED: "warn",
  REAL: "info",
  OTC: "muted",
};

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "muted";
  const label = status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return <Pill tone={tone}>{label}</Pill>;
}

export function Tag({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={`admin-tag${accent ? " admin-tag--accent" : ""}`}>{children}</span>;
}

/* --------------------------------- Avatar ---------------------------------- */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="admin-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        borderRadius: Math.round(size / 4),
      }}
    >
      {initials(name)}
    </span>
  );
}

/* --------------------------------- Delta ----------------------------------- */
export function Delta({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`admin-delta ${up ? "up" : "down"}`}>
      <Icon name={up ? "arrowUp" : "arrowDown"} size={12} />
      {Math.abs(pct).toFixed(pct % 1 === 0 ? 0 : 1)}%
    </span>
  );
}

/* ---------------------------------- Cards ---------------------------------- */
export function StatCard({
  label,
  value,
  icon,
  foot,
  warn,
}: {
  label: string;
  value: string;
  icon: IconName;
  foot?: ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="admin-stat">
      <div className="admin-stat__top">
        <span className="admin-stat__label">{label}</span>
        <span
          className="admin-stat__ic"
          style={
            warn
              ? { background: "var(--admin-warn-soft)", color: "var(--admin-warn)" }
              : undefined
          }
        >
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="admin-stat__val">{value}</div>
      {foot ? <div className="admin-stat__foot">{foot}</div> : null}
    </div>
  );
}

export function Card({
  title,
  sub,
  action,
  children,
  bodyClass,
  noBody,
}: {
  title?: string;
  sub?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
  noBody?: boolean;
}) {
  return (
    <div className="admin-card">
      {title ? (
        <div className="admin-card__head">
          <div>
            <h3>{title}</h3>
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          {action ? (
            <>
              <div className="admin-spacer" />
              {action}
            </>
          ) : null}
        </div>
      ) : null}
      {noBody ? children : <div className={`admin-card__body ${bodyClass ?? ""}`}>{children}</div>}
    </div>
  );
}

/* ------------------------------ Sortable header ---------------------------- */
export function SortableTh({
  label,
  colKey,
  path,
  sp,
  align,
}: {
  label: string;
  colKey: string;
  path: string;
  sp: Record<string, string | undefined>;
  align?: "right";
}) {
  const active = sp.sort === colKey;
  const nextDir = active && sp.dir === "asc" ? "desc" : "asc";
  const caret = active ? (sp.dir === "asc" ? "▲" : "▼") : "▲";
  return (
    <th
      className={active ? "sorted" : undefined}
      style={align === "right" ? { textAlign: "right" } : undefined}
    >
      <Link href={hrefWith(path, sp, { sort: colKey, dir: nextDir, page: 1 })}>
        {label}
        <span className="caret">{caret}</span>
      </Link>
    </th>
  );
}

/* --------------------------------- Pager ----------------------------------- */
export function Pager({
  total,
  page,
  perPage,
  path,
  sp,
}: {
  total: number;
  page: number;
  perPage: number;
  path: string;
  sp: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (pages <= 7 || p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  return (
    <div className="admin-pager">
      <span className="info">
        Showing <b>{from}&ndash;{to}</b> of <b>{total}</b>
      </span>
      <div className="pages">
        <Link
          className={`admin-page-btn${page === 1 ? " disabled" : ""}`}
          href={hrefWith(path, sp, { page: page - 1 })}
          aria-label="Previous page"
        >
          &lsaquo;
        </Link>
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="admin-page-btn disabled" style={{ border: "none" }}>
              …
            </span>
          ) : (
            <Link
              key={n}
              className={`admin-page-btn${n === page ? " active" : ""}`}
              href={hrefWith(path, sp, { page: n })}
            >
              {n}
            </Link>
          ),
        )}
        <Link
          className={`admin-page-btn${page >= pages ? " disabled" : ""}`}
          href={hrefWith(path, sp, { page: page + 1 })}
          aria-label="Next page"
        >
          &rsaquo;
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------- Empty row -------------------------------- */
export function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols}>
        <div className="admin-empty">
          <Icon name="inbox" size={34} />
          <div>{message}</div>
        </div>
      </td>
    </tr>
  );
}

/* ---------------------------------- Charts --------------------------------- */
/** Daily bars with the last bar (today) highlighted and labelled. */
export function BarChart({
  points,
  labels,
  format,
}: {
  points: number[];
  labels: string[];
  format: (v: number) => string;
}) {
  const W = 720;
  const H = 210;
  const padT = 28;
  const padB = 22;
  const max = Math.max(...points, 1);
  const n = points.length;
  const slot = W / n;
  const bw = Math.max(2, slot * 0.62);
  const ih = H - padT - padB;
  const last = n - 1;
  const lastH = Math.max(2, (points[last]! / max) * ih);
  const avg = points.slice(0, last).reduce((s, v) => s + v, 0) / Math.max(1, last);
  return (
    <svg
      className="admin-chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Daily trade volume. Today ${format(points[last] ?? 0)}, daily average before today ${format(avg)}.`}
    >
      {[0, 1, 2].map((g) => {
        const gy = padT + (g / 2) * ih;
        return <line key={g} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--admin-border-soft)" strokeWidth={1} />;
      })}
      {points.map((v, i) => {
        const h = Math.max(2, (v / max) * ih);
        return (
          <rect
            key={i}
            x={(i * slot + (slot - bw) / 2).toFixed(1)}
            y={(padT + ih - h).toFixed(1)}
            width={bw.toFixed(1)}
            height={h.toFixed(1)}
            rx={2}
            fill={i === last ? "var(--admin-accent)" : "#24426e"}
          >
            <title>{`${labels[i]}: ${format(v)}`}</title>
          </rect>
        );
      })}
      <text
        x={Math.min(W - 4, last * slot + slot / 2).toFixed(1)}
        y={(padT + ih - lastH - 8).toFixed(1)}
        fill="var(--admin-ink)"
        fontSize={12}
        fontWeight={700}
        textAnchor="end"
      >
        Today {format(points[last] ?? 0)}
      </text>
      {[0, Math.floor(n / 2), last].map((i) => (
        <text
          key={i}
          x={(i * slot + slot / 2).toFixed(1)}
          y={H - 5}
          fill="var(--admin-faint)"
          fontSize={11}
          textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
        >
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

export function AreaChart({
  points,
  labels,
}: {
  points: number[];
  labels?: string[];
}) {
  const W = 720;
  const H = 220;
  const padT = 12;
  const padB = 22;
  const padX = 8;
  const min = Math.min(...points) * 0.94;
  const max = Math.max(...points) * 1.04 || 1;
  const iw = W - padX * 2;
  const ih = H - padT - padB;
  const x = (i: number) => padX + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => padT + ih - ((v - min) / (max - min || 1)) * ih;

  let line = "";
  points.forEach((v, i) => {
    line += (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " ";
  });
  const area =
    line +
    `L${x(points.length - 1).toFixed(1)} ${padT + ih} L${x(0).toFixed(1)} ${padT + ih} Z`;

  const gridlines = [0, 1, 2, 3].map((g) => {
    const gy = padT + (g / 3) * ih;
    return (
      <line
        key={g}
        x1={padX}
        y1={gy.toFixed(1)}
        x2={W - padX}
        y2={gy.toFixed(1)}
        stroke="var(--admin-border)"
        strokeWidth={1}
      />
    );
  });

  const gid = "adminArea";
  return (
    <svg className="admin-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend chart">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--admin-accent)" stopOpacity={0.28} />
          <stop offset="100%" stopColor="var(--admin-accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {gridlines}
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--admin-accent)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {points.map((v, i) =>
        i === points.length - 1 ? (
          <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill="var(--admin-accent)" />
        ) : null,
      )}
      {labels
        ? [0, Math.floor(labels.length / 2), labels.length - 1].map((i) => (
            <text
              key={i}
              x={x(i).toFixed(1)}
              y={H - 5}
              fill="var(--admin-faint)"
              fontSize={11}
              textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
            >
              {labels[i]}
            </text>
          ))
        : null}
    </svg>
  );
}

export function Donut({
  segments,
  centerLabel,
  centerSub,
  size = 168,
}: {
  segments: { label: string; pct: number; color: string }[];
  centerLabel: string;
  centerSub: string;
  size?: number;
}) {
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Allocation">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--admin-surface-3)" strokeWidth={16} />
      {segments.map((s) => {
        const len = (s.pct / 100) * C;
        const el = (
          <circle
            key={s.label}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={16}
            strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`}
            strokeDashoffset={(-offset).toFixed(2)}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        offset += len;
        return el;
      })}
      <text
        x={cx}
        y={cy - 3}
        fill="var(--admin-ink)"
        fontSize={22}
        fontWeight={600}
        fontFamily="var(--admin-font-mono)"
        textAnchor="middle"
      >
        {centerLabel}
      </text>
      <text
        x={cx}
        y={cy + 14}
        fill="var(--admin-muted)"
        fontSize={10}
        textAnchor="middle"
        letterSpacing="0.08em"
      >
        {centerSub}
      </text>
    </svg>
  );
}

export function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const W = 96;
  const H = 30;
  const p = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const rng = max - min || 1;
  const x = (i: number) => p + (i / (points.length - 1)) * (W - 2 * p);
  const y = (v: number) => p + (H - 2 * p) - ((v - min) / rng) * (H - 2 * p);
  let d = "";
  points.forEach((v, i) => (d += (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " "));
  return (
    <svg className="admin-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={up ? "var(--admin-pos)" : "var(--admin-neg)"}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
