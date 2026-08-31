import type { ReactNode } from "react";

/**
 * Panel (Workstream D.5 §4/§9) — the default Pursuit surface. A soft glass card
 * that builds hierarchy from material and space, NOT a hard outline. An optional
 * accent token tints the surface faintly so different operating surfaces keep
 * their identity. `tint` false gives a plain raised card.
 */
export function Panel({
  title, eyebrow, hint, aside, accent, children, className = "", tint = false,
}: {
  title?: string;
  /**
   * Deprecated. A kicker above a heading is decoration: the heading carries its
   * own weight, and a coloured uppercase line above it competes with the thing
   * it is introducing. Anything passed here now renders BELOW the title as a
   * hint, which is what the copy in all eleven call sites was actually doing.
   */
  eyebrow?: string;
  /** One short clause under the heading. Long explanation belongs in a Disclosure. */
  hint?: string;
  aside?: ReactNode;
  accent?: string;               // a --color-* var, e.g. "var(--color-route)"
  children: ReactNode;
  className?: string;
  tint?: boolean;
}) {
  const bg = tint && accent ? `color-mix(in srgb, ${accent} 4%, var(--surface-primary))` : undefined;
  return (
    <section className={`glass rounded-card p-5 ${className}`} style={bg ? { background: bg } : undefined}>
      {(title || aside) && (
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-title font-bold tracking-[-0.015em] ink">{title}</h2>}
            {(hint ?? eyebrow) && <p className="mt-0.5 text-body ink-faint">{hint ?? eyebrow}</p>}
          </div>
          {aside && <div className="flex-none">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
