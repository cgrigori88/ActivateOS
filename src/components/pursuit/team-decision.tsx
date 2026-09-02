"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PursuitTeamView, TeamMemberView } from "@/lib/pursuits/read-models/types";
import { decideTeamAction } from "@/app/pursuits/[id]/actions";
import { TeamStatusBadge, BandPill } from "./parts";
import { buttonClass } from "@/components/ui";

/**
 * Multi-Party Execution Plan (Phase C2/C3). The pursuit team as a governed worklist, folded into
 * Pursuit Detail: who is on this pursuit, what state each role is in, and the one governed step an
 * operator can take next. Recommendation ≠ decision — a recommended member is a proposal until it is
 * CONFIRMED; a confirmed (invited) member is then marked ACCEPTED, which feeds readiness. Every move
 * posts through `decideTeamAction` → `dispatchSkill`; nothing here mutates directly. A
 * confirmed-but-unaccepted role reads as "waiting on this participant".
 */

const ROLE = (r: string) => r.replace(/_/g, " ").toLowerCase();

export function ExecutionPlan({ team, pursuitId, canDecide }: { team: PursuitTeamView; pursuitId: string; canDecide: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (memberId: string, action: "confirm" | "accept" | "decline") => {
    setError(null); setBusyId(memberId);
    startTransition(async () => {
      const res = await decideTeamAction(pursuitId, memberId, action);
      setBusyId(null);
      if (!res.ok) { setError(res.error ?? "Team decision was not accepted."); return; }
      router.refresh();
    });
  };

  const waiting = team.members.filter((m) => m.waiting);

  return (
    <div>
      {/* Waiting-on band — the pursuit is held on these participants' acceptance. */}
      {waiting.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card px-3 py-2 text-label"
          style={{ background: "color-mix(in srgb, var(--color-timing) 9%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-timing) 24%, transparent)" }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-timing)" }} aria-hidden />
          <span className="font-semibold" style={{ color: "var(--color-timing, #b45309)" }}>Waiting on</span>
          <span className="text-neutral-500">{waiting.map((m) => m.partnerLabel ?? ROLE(m.role)).join(", ")} to accept.</span>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {team.members.map((m) => (
          <MemberRow key={m.id} m={m} canDecide={canDecide} busy={pending && busyId === m.id} onAct={act} />
        ))}
      </div>

      {error && <p className="mt-2 text-label" style={{ color: "var(--color-accent-risk)" }}>{error}</p>}

      {team.missingRequiredRoles.length > 0 && (
        <div className="mt-2.5 rounded-card p-3 text-body" style={{ background: "color-mix(in srgb, var(--color-accent-attention) 9%, transparent)" }}>
          <b style={{ color: "var(--color-accent-attention)" }}>Readiness held.</b> Required role(s) not yet accepted: {team.missingRequiredRoles.map(ROLE).join(", ")}.
        </div>
      )}
      <p className="mt-2 text-micro text-neutral-400">
        Confirm and accept are governed decisions — a recompute may change the recommended team, never a confirmed assignment.
      </p>
    </div>
  );
}

function MemberRow({ m, canDecide, busy, onAct }: { m: TeamMemberView; canDecide: boolean; busy: boolean; onAct: (id: string, a: "confirm" | "accept" | "decline") => void }) {
  return (
    /* STACKED, not side-by-side. These cards sit two-up inside a side panel, so
       each is about 150px wide — and the status badge and governed action are
       both shrink-0, which left the name roughly forty pixels. Laid out in a
       row, "distributor bdm" either truncated to "dist…" or hard-broke into
       "distri / butor / bdm"; the role IS the row, so both outcomes lose the
       only thing it says. Stacking gives the name the full card width and the
       controls their own line, and it holds at any panel width. */
    <div className="flex flex-col gap-2 rounded-card px-3.5 py-2.5" style={{ background: "var(--surface-inset)" }}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-body font-semibold">
          <span>{m.personLabel ?? m.partnerLabel ?? ROLE(m.role)}</span>
          {m.required && <span className="rounded-inner px-1 py-px text-micro font-bold uppercase tracking-[0.04em] text-neutral-400" style={{ boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>req</span>}
        </div>
        <div className="text-label text-neutral-400">{m.personLabel || m.partnerLabel ? ROLE(m.role) : `${m.side.toLowerCase()} side`}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {m.fit && <BandPill band={m.fit.band} />}
        <TeamStatusBadge status={m.status} />
        {canDecide && m.nextGovernedAction === "confirm" && (
          <button type="button" disabled={busy} onClick={() => onAct(m.id, "confirm")}
            className={buttonClass("primary", "sm")}>{busy ? "…" : "Confirm"}</button>
        )}
        {canDecide && m.nextGovernedAction === "accept" && (
          <button type="button" disabled={busy} onClick={() => onAct(m.id, "accept")}
            className={buttonClass("primary", "sm")}>{busy ? "…" : "Mark accepted"}</button>
        )}
      </div>
    </div>
  );
}
