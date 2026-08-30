import type { ReactNode } from "react";

/**
 * Panel (Workstream D.5 §4/§9) — the default Pursuit surface. A soft glass card
 * that builds hierarchy from material and space, NOT a hard outline. An optional
 * accent token tints the surface faintly so different operating surfaces keep
 * their identity. `tint` false gives a plain raised card.
 */
export function Panel({
  title, eyebrow, aside, accent, children, className = "", tint = false,
}: {
  title?: string;
  eyebrow?: string;
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
          <div>
            {eyebrow && <div className="text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: accent ?? "var(--color-neutral-500)" }}>{eyebrow}</div>}
            {title && <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>}
          </div>
          {aside && <div className="flex-none">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
