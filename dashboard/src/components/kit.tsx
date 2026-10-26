/**
 * The ledger kit. Built once, used everywhere.
 *
 * Rules encoded here rather than left to each screen:
 *   - --signal appears in exactly one place per screen, and never here except
 *     on the track and the single primary action.
 *   - no state is expressed with a new colour: success is a stamp, warning is a
 *     pencil hatch, error is a double underline and an ERR prefix.
 *   - rows are 36px, hairlines only, no shadow, no radius beyond 2px.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ Stamp */

export function Stamp({
  children,
  tone = "ok",
}: {
  children: ReactNode;
  tone?: "ok" | "plain";
}) {
  return (
    <span className={`stamp stamp--${tone}`} data-testid="stamp">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Badge */

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}

/* ------------------------------------------------------------------- Slip */

export function Slip({
  children,
  title,
  onClose,
  role = "group",
}: {
  children: ReactNode;
  title?: string;
  onClose?: () => void;
  role?: "group" | "dialog" | "alertdialog";
}) {
  const id = useId();
  return (
    <div className="slip-app" role={role} aria-labelledby={title ? id : undefined}>
      {title ? (
        <div className="slip-app__head">
          <h2 className="slip-app__title" id={id}>
            {title}
          </h2>
          {onClose ? (
            <button type="button" className="ld-btn ld-btn--mono" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="slip-app__body">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ Entry
   The only settings layout. No cards anywhere. */

export function Entry({
  label,
  hint,
  section,
  control,
}: {
  label: string;
  hint?: string;
  /** the marginal § reference, e.g. "2.3" */
  section?: string;
  control: ReactNode;
}) {
  return (
    <div className="entry">
      <div className="entry__label">
        {section ? <span className="entry__section num">§ {section}</span> : null}
        <span className="entry__name">{label}</span>
        {hint ? <span className="entry__hint">{hint}</span> : null}
      </div>
      <div className="entry__control">{control}</div>
    </div>
  );
}

/* ------------------------------------------------------------ LedgerTable */

export type Column<T> = {
  key: string;
  head: string;
  /** right-aligned, tabular */
  numeric?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
};

export function LedgerTable<T>({
  caption,
  rows,
  columns,
  rowKey,
  onRowActivate,
  indexColumn = true,
}: {
  caption: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowActivate?: (row: T) => void;
  indexColumn?: boolean;
}) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // j / k walk the rows, which is what a ledger is for.
  function onKeyDown(e: React.KeyboardEvent<HTMLTableSectionElement>) {
    if (e.key !== "j" && e.key !== "k") return;
    const focusables = Array.from(
      bodyRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [],
    );
    const at = focusables.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "j" ? Math.min(focusables.length - 1, at + 1) : Math.max(0, at - 1);
    focusables[next]?.focus();
    e.preventDefault();
  }

  return (
    <table className="ledger-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {indexColumn ? <th scope="col" className="ledger-table__idx" aria-label="Row" /> : null}
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              style={c.width ? { width: c.width } : undefined}
              className={c.numeric ? "is-numeric" : undefined}
            >
              {c.head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody ref={bodyRef} onKeyDown={onKeyDown}>
        {rows.map((row, i) => (
          <tr
            key={rowKey(row)}
            data-row
            tabIndex={0}
            onClick={onRowActivate ? () => onRowActivate(row) : undefined}
            onKeyDown={
              onRowActivate
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowActivate(row);
                    }
                  }
                : undefined
            }
          >
            {indexColumn ? (
              <td className="ledger-table__idx num">{String(i + 1).padStart(2, "0")}</td>
            ) : null}
            {columns.map((c) => (
              <td key={c.key} className={c.numeric ? "is-numeric num" : undefined}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ Switch
   A sliding tick on a ruled slot. Not a pill. */

export function Switch({
  checked,
  onChange,
  label,
  locked,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** an invariant: shown as "LOCK", cannot be turned off */
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={locked}
      className={`sw${locked ? " sw--off" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="sw__slot" aria-hidden="true">
        <span className="sw__tick" />
      </span>
      <span className="sw__state num">{locked ? "LOCK" : checked ? "on" : "off"}</span>
    </button>
  );
}

/* ------------------------------------------------------- Segmented control
   Ledger column tabs. */

export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="segmented ledger-seg" role="radiogroup" aria-label={legend}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="ledger-seg__tab"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ inputs */

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <span className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`field__input ${mono ? "num" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  locked,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  locked?: boolean;
  hint?: string;
}) {
  return (
    <label className={`check ${locked ? "check--locked" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="check__box" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="check__label">
        {label}
        {locked ? <span className="check__lock num"> locked</span> : null}
        {hint ? <span className="check__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  title,
  body,
  action,
  specimen = "track",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  specimen?: "track" | "lines" | "slip";
}) {
  return (
    <div className="empty">
      {specimen === "track" ? (
        <svg className="empty__art" viewBox="0 0 180 24" role="presentation" aria-hidden="true">
          <line x1="4" y1="12" x2="176" y2="12" className="empty__line" />
          <circle cx="18" cy="12" r="4" className="empty__ring" />
          <circle cx="52" cy="12" r="6" className="empty__ring" />
          <circle cx="92" cy="12" r="8.5" className="empty__ring" />
          <circle cx="140" cy="12" r="5" className="empty__ring" />
        </svg>
      ) : specimen === "lines" ? (
        <svg className="empty__art" viewBox="0 0 180 40" role="presentation" aria-hidden="true">
          {[4, 14, 24, 34].map((y) => (
            <line key={y} x1="0" y1={y} x2="180" y2={y} className="empty__line" />
          ))}
        </svg>
      ) : (
        <div className="empty__slip" aria-hidden="true" />
      )}
      <p className="empty__title">{title}</p>
      <p className="empty__body">{body}</p>
      {action ? <p className="empty__action">{action}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Skeleton
   Ruled lines with a static pencil dash. No shimmer. */

export function Skeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton__row" style={{ width: `${94 - i * 11}%` }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Banner/err
   Errors are a double underline in ink and an ERR prefix. Never red. */

export function Notice({
  kind,
  title,
  detail,
  action,
}: {
  kind: "err" | "check" | "info";
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice--${kind}`} role={kind === "err" ? "alert" : "status"}>
      <span className="notice__tag num">{kind === "err" ? "ERR" : kind === "check" ? "CHECK" : "—"}</span>
      <span className="notice__body">
        <strong className="notice__title">{title}</strong>
        {detail ? <span className="notice__detail">{detail}</span> : null}
      </span>
      {action ? <span className="notice__action">{action}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Toast */

type ToastMsg = { id: number; text: string };
const ToastCtx = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const seq = useRef(0);

  function push(text: string) {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, text }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-host" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------- Dirty-state slip */

export function UnpostedBar({
  count,
  onDiscard,
  onPost,
}: {
  count: number;
  onDiscard: () => void;
  onPost: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="unposted" role="status">
      <span className="unposted__text">
        Unposted changes (<span className="num">{count}</span>)
      </span>
      <button type="button" className="ld-btn ld-btn--mono" onClick={onDiscard}>
        Discard
      </button>
      {/* the one --signal action on a settings screen */}
      <button type="button" className="ld-btn ld-btn--primary" onClick={onPost}>
        Post changes
      </button>
    </div>
  );
}

/* ---------------------------------------------------------- useDebounced */

export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
