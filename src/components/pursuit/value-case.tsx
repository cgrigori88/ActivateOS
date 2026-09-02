import {
  bounds, qualityLine, usd, STATE_LABEL, ECONOMIC_TRUTH_LABEL, ECONOMIC_TRUTH_MEANING,
  type ValueCase, type ValueCaseState,
} from "@/lib/value/case";
import { LADDER_LABEL, type Driver, type Ladder } from "@/lib/value/drivers";
import { Disclosure } from "@/components/ui";

/**
 * The Value Case section on Pursuit Detail (P2B §12).
 *
 * Compact first. The opening view is four lines an operator can read in about two seconds —
 * modeled impact, evidence quality, biggest uncertainty, and the one action. Everything forensic
 * (drivers, provenance, competing values, supersession, sensitivity arithmetic) lives behind
 * progressive disclosure, exactly as the lifecycle bento does.
 *
 * There is deliberately no /value-case room: the Value Case is a property of a Pursuit, not a
 * destination.
 */

const stateHue = (s: ValueCaseState): string =>
  s === "CONFLICTING" ? "var(--color-accent-attention)"
    : s === "STRONG" ? "var(--color-readiness)"
      : s === "INCOMPLETE" ? "var(--color-timing)"
        : "var(--text-muted, #9ca3af)";

const ladderHue = (l: Ladder): string =>
  l === "VERIFIED" || l === "CUSTOMER_CONFIRMED" ? "var(--color-readiness)"
    : l === "INFERRED" ? "var(--color-timing)"
      : "var(--color-accent-attention)";

function Chip({ text, hue }: { text: string; hue: string }) {
  return (
    <span className="rounded-full px-1.5 py-0.5 text-micro font-bold uppercase tracking-[0.04em]"
      style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)` }}>
      {text}
    </span>
  );
}

/**
 * The three economic truths, side by side and LABELLED. §2 forbids showing three dollar amounts
 * without saying what each means, so the meaning is rendered, not left to the reader.
 */
function ThreeTruths({ vc }: { vc: ValueCase }) {
  const cells: { key: keyof typeof ECONOMIC_TRUTH_LABEL; value: string | null }[] = [
    { key: "dealAmount", value: vc.dealAmount != null ? usd(vc.dealAmount) : null },
    { key: "expectedValue", value: vc.expectedValue != null ? usd(vc.expectedValue) : null },
    { key: "modeledImpact", value: vc.defensible && vc.modeledImpact ? bounds(vc.modeledImpact) : null },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {cells.map((c) => (
        <div key={c.key} className="rounded-card px-2.5 py-2" style={{ background: "var(--surface-inset)" }}>
          <div className="text-micro font-bold uppercase tracking-[0.06em] text-neutral-400">
            {ECONOMIC_TRUTH_LABEL[c.key]}
          </div>
          <div className="text-title font-bold tnum">
            {c.value ?? <span className="text-copy font-semibold text-neutral-400">UNKNOWN</span>}
          </div>
          <div className="mt-0.5 text-micro leading-snug text-neutral-500">{ECONOMIC_TRUTH_MEANING[c.key]}</div>
        </div>
      ))}
    </div>
  );
}

function DriverRow({ d }: { d: Driver }) {
  return (
    <details className="rounded-card">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 rounded-card px-2 py-1.5 hover:bg-neutral-900/[0.03] dark:hover:bg-white/[0.05]">
        <span className="text-body font-semibold">{d.label}</span>
        <Chip text={d.conflicting ? "conflicting" : LADDER_LABEL[d.ladder]} hue={d.conflicting ? "var(--color-accent-attention)" : ladderHue(d.ladder)} />
        <span className="text-body tnum">
          {d.conflicting
            /* Every competing figure, never an average (§17). */
            ? d.values.map((v, i) => (
                <span key={v.factId}>
                  {i > 0 && <span className="text-neutral-400"> vs </span>}
                  <b>{v.low === v.high ? usd(v.low) : `${usd(v.low)}–${usd(v.high)}`}</b>
                </span>
              ))
            : d.value && <b>{d.value.low === d.value.high ? usd(d.value.low) : `${usd(d.value.low)}–${usd(d.value.high)}`}</b>}
        </span>
        <span className="ml-auto text-micro uppercase tracking-[0.05em] text-neutral-400">{d.role.toLowerCase()}</span>
      </summary>
      <div className="space-y-1 px-2 pb-2 pt-1 text-body text-neutral-500">
        <ul className="space-y-0.5">
          {d.values.map((v) => (
            <li key={v.factId}>
              {v.low === v.high ? usd(v.low) : `${usd(v.low)}–${usd(v.high)}`}
              {" — "}{LADDER_LABEL[v.ladder]} ({v.provenanceClass.replace(/_/g, " ").toLowerCase()})
              {v.sourceLabel && <span className="text-neutral-400"> · {v.sourceLabel}</span>}
              {v.evidenceCount > 0 && <span className="text-neutral-400"> · {v.evidenceCount} evidence</span>}
              {!v.disclosureClass || v.disclosureClass !== "PARTNER_SHARED"
                ? <span className="ml-1 text-micro font-bold uppercase" style={{ color: "var(--color-accent-attention)" }}>sponsor only</span>
                : null}
            </li>
          ))}
        </ul>
        {d.history.length > 0 && (
          <p className="text-neutral-400">
            Superseded: {d.history.map((h) => (h.low === h.high ? usd(h.low) : `${usd(h.low)}–${usd(h.high)}`)).join(", ")} — kept as history.
          </p>
        )}
      </div>
    </details>
  );
}

export function ValueCaseCard({ vc }: { vc: ValueCase }) {
  const top = vc.sensitivity[0];

  if (vc.state === "NOT_ESTABLISHED") {
    return (
      <p className="text-body text-neutral-500">
        Value case <b>not established</b> — no economic facts on this account. What is at stake, and what changing
        it would be worth, has not been captured. A customer-confirmed cost figure would start it.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <ThreeTruths vc={vc} />

      {/* The honest headline. A case that cannot be defended says so instead of printing a range. */}
      <div className="flex flex-wrap items-baseline gap-2 text-body">
        <Chip text={STATE_LABEL[vc.state]} hue={stateHue(vc.state)} />
        <span className="text-neutral-600 dark:text-neutral-300">{vc.because}</span>
      </div>

      {!vc.defensible && (
        <p className="text-body font-semibold" style={{ color: "var(--color-accent-attention)" }}>
          Value case not yet defensible — no modeled range is stated.
        </p>
      )}

      <div className="space-y-1 text-body">
        <div className="flex gap-2">
          <span className="w-[118px] shrink-0 text-neutral-400">Evidence quality</span>
          <span className="min-w-0 flex-1">{qualityLine(vc.quality)}</span>
        </div>
        {vc.baseline && (
          <div className="flex gap-2">
            <span className="w-[118px] shrink-0 text-neutral-400">At stake today</span>
            <span className="min-w-0 flex-1">
              <b className="tnum">{bounds(vc.baseline)}</b>
              <span className="text-neutral-500"> recurring current-state cost — context, not impact</span>
            </span>
          </div>
        )}
        {vc.changeCost && (
          <div className="flex gap-2">
            <span className="w-[118px] shrink-0 text-neutral-400">Cost to change</span>
            <span className="min-w-0 flex-1 tnum"><b>{bounds(vc.changeCost)}</b></span>
          </div>
        )}
        {top && (
          <div className="flex gap-2">
            <span className="w-[118px] shrink-0 text-neutral-400">Biggest uncertainty</span>
            <span className="min-w-0 flex-1">
              <b>{top.label}</b>
              <span className="text-neutral-500"> · {top.conflicting ? "conflicting" : LADDER_LABEL[top.ladder]}</span>
            </span>
          </div>
        )}
      </div>

      {/* ── The signature interaction (§6). Progressive disclosure: the arithmetic on demand. ── */}
      {vc.sensitivity.length > 0 && (
        <details className="rounded-card border" style={{ borderColor: "var(--border-subtle)" }}>
          <summary className="cursor-pointer rounded-card px-2.5 py-1.5 text-body font-semibold text-accent hover:bg-neutral-900/[0.03] dark:text-blue-400 dark:hover:bg-white/[0.05]">
            What would strengthen this Value Case?
          </summary>
          <div className="space-y-2 px-2.5 pb-2.5 pt-1">
            {vc.modeledImpact && vc.defensible && (
              <p className="text-body text-neutral-500">
                Current modeled range <b className="tnum">{bounds(vc.modeledImpact)}</b>
                {" "}(width <b className="tnum">{usd(vc.modeledImpact.high - vc.modeledImpact.low)}</b>).
              </p>
            )}
            <ol className="space-y-1.5">
              {vc.sensitivity.slice(0, 5).map((s, i) => (
                <li key={s.predicateKey} className="text-body">
                  <span className="mr-1 text-neutral-400">{i + 1}.</span>
                  <b>{s.label}</b>
                  <Chip text={s.conflicting ? "conflicting" : LADDER_LABEL[s.ladder]} hue={s.conflicting ? "var(--color-accent-attention)" : ladderHue(s.ladder)} />
                  <div className="pl-4 text-neutral-500">
                    {s.reason}{" "}
                    {s.narrowsRangeBy != null && s.narrowsRangeBy > 0 ? (
                      <>Verifying it within its current bounds narrows the modeled range by{" "}
                        <b className="tnum text-neutral-700 dark:text-neutral-200">{usd(s.narrowsRangeBy)}</b>.</>
                    ) : s.affects === "AT_STAKE_TODAY" ? (
                      <span className="italic">Firming it up moves &ldquo;at stake today&rdquo;, not the modeled range.</span>
                    ) : (
                      <span className="italic">Its effect on the range cannot be calculated yet.</span>
                    )}
                    <div className="mt-0.5">{s.ask}</div>
                  </div>
                </li>
              ))}
            </ol>
            <Disclosure summary="How the range is derived">
              Interval arithmetic over the drivers below. No confidence percentage is claimed, because
              no calibrated model for one exists.
            </Disclosure>
          </div>
        </details>
      )}

      {/* Drivers, provenance, contradictions, supersession — one click down. */}
      {vc.drivers.length > 0 && (
        <details className="rounded-card border" style={{ borderColor: "var(--border-subtle)" }}>
          <summary className="cursor-pointer rounded-card px-2.5 py-1.5 text-body font-semibold hover:bg-neutral-900/[0.03] dark:hover:bg-white/[0.05]">
            Economic drivers <span className="font-normal text-neutral-400">({vc.drivers.length})</span>
          </summary>
          <div className="space-y-0.5 px-1 pb-2">
            {vc.drivers.map((d) => <DriverRow key={d.predicateKey} d={d} />)}
            {vc.missing.length > 0 && (
              <p className="px-2 pt-1 text-label text-neutral-400">
                No figure at all for: {vc.missing.map((m) => m.replace(/_/g, " ")).join(", ")} — preserved as UNKNOWN, not assumed to be zero.
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** The partner-facing statement — never the internal total (§10, §16). */
export function PartnerValueLine({ summary, confidential }: { summary: string; confidential: boolean }) {
  return (
    <div className="space-y-1 text-body">
      <div>{summary}</div>
      {confidential && (
        <div className="text-label text-neutral-400">
          Additional sponsor-confidential economic context exists and is not included here.
        </div>
      )}
    </div>
  );
}
