/**
 * Controls. Every interactive element here has: a visible label or an accessible
 * name, a 44px touch target on coarse pointers, pressed feedback that does not
 * shift layout, and a focus ring that is never removed.
 */
import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/* ---------------------------------------------------------------- button */

type ButtonVariant = "primary" | "quiet" | "danger" | "inline";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Shows progress and disables: the action's own name, then its confirmation. */
  loading?: boolean;
  loadingLabel?: string;
  block?: boolean;
};

export function Button({
  variant = "primary",
  loading = false,
  loadingLabel = "Working…",
  block = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    variant === "primary" ? "btn--primary" : null,
    variant === "quiet" ? "btn--quiet" : null,
    variant === "danger" ? "btn--danger" : null,
    variant === "inline" ? "btn--inline" : null,
    block ? "btn--block" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={["icon-btn", className ?? null].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- field */

type FieldRenderProps = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean | undefined;
};

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  /** The message to show after a failed validation: cause plus fix. */
  error?: string | null;
  children: (props: FieldRenderProps) => ReactNode;
};

export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p className="field__hint" id={hintId ?? undefined}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId ?? undefined} role="alert">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** After a failed submit with more than one problem, focus moves here. */
export function ErrorSummary({
  id,
  errors,
}: {
  id: string;
  errors: Array<{ fieldId: string; message: string }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (errors.length === 0) return null;
  return (
    <div className="error-summary" role="alert" tabIndex={-1} id={id} ref={ref}>
      <h3>Check these fields</h3>
      <ul>
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a
              href={`#${e.fieldId}`}
              onClick={() => {
                const el = document.getElementById(e.fieldId);
                el?.focus();
                ref.current?.classList.add("error-summary--visited");
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- switch */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{label}</span>
    </button>
  );
}

/* --------------------------------------------------- segmented radiogroup */

export type SegmentedOption<T extends string> = { value: T; label: string; hint?: string };

export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  className,
}: {
  legend: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (next: T) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      className={["segmented", className ?? null].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={legend}
    >
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          className="segmented__option"
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(i, -1);
            }
          }}
        >
          {option.label}
          {option.hint ? <span className="small muted" style={{ display: "block" }}>{option.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
