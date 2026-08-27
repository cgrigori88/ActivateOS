"use client";

import { useMemo, useState } from "react";
import {
  CANONICAL_FIELDS,
  GROUP_LABEL,
  customKey,
  type ColumnMapping,
  type ColumnProfile,
  type FieldGroup,
} from "@/lib/ingest/fields";

/**
 * The mapping review — the human half of the intake handshake. Every CSV
 * column shows what was detected (type, fill, samples) and where it will land
 * (a canonical field, a custom pass-through field, or nowhere). The surface
 * toggles decide which fields the rest of the platform gets to see
 * (population.selected_fields): imported-but-unsurfaced fields stay stored on
 * the members, invisible in the matrix until surfaced later.
 */

const input =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "customer", label: "Customers" },
  { value: "open_opportunity", label: "Open Opportunities" },
  { value: "prospect", label: "Prospects" },
  { value: "target", label: "Targets" },
  { value: "segment", label: "Segment" },
  { value: "territory", label: "Territory" },
  { value: "vertical", label: "Vertical" },
  { value: "custom", label: "Custom" },
];

const PARTNER_TYPES = ["reseller", "distributor", "vendor", "msp", "solution_provider", "agent", "alliance"];

const GROUPS: FieldGroup[] = ["account", "relationship", "contact", "commercial"];

type ColState = {
  target: string; // canonical key | custom key | "" (skip)
  custom: boolean;
  surfaced: boolean;
};

export function MappingReview({
  batchId,
  filename,
  rowCount,
  headers,
  profiles,
  proposal,
  preview,
  partners,
  defaultName,
  defaultCategory,
  commit,
  discard,
  kind = "book",
}: {
  batchId: string;
  filename: string | null;
  rowCount: number;
  headers: string[];
  profiles: ColumnProfile[];
  proposal: ColumnMapping[];
  preview: string[][];
  partners: { id: string; name: string; type: string | null }[];
  defaultName: string;
  defaultCategory: string;
  commit: (fd: FormData) => Promise<void>;
  discard: () => Promise<void>;
  /** "book" = partner/account list (default); "crm" = CRM opportunity export; "enrichment" = third-party signal export. */
  kind?: "book" | "crm" | "enrichment";
}) {
  const [cols, setCols] = useState<ColState[]>(() =>
    headers.map((_, i) => {
      const p = proposal.find((m) => m.index === i);
      return { target: p?.target ?? "", custom: p?.custom ?? true, surfaced: p?.surfaced ?? false };
    }),
  );
  const [partnerSel, setPartnerSel] = useState<string>(partners.length > 0 ? "none" : "new");

  const setCol = (i: number, patch: Partial<ColState>) =>
    setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const pick = (i: number, value: string) => {
    if (value === "__custom__") {
      setCol(i, { target: customKey(headers[i] ?? `column_${i + 1}`), custom: true, surfaced: true });
      return;
    }
    if (value === "") {
      setCol(i, { target: "", custom: false, surfaced: false });
      return;
    }
    // a canonical field can hold only one column — stealing it clears the other
    setCols((cs) =>
      cs.map((c, j) =>
        j === i
          ? { target: value, custom: false, surfaced: true }
          : c.target === value && !c.custom
            ? { target: "", custom: false, surfaced: false }
            : c,
      ),
    );
  };

  const companyMapped = cols.some((c) => c.target === "company");
  const kept = cols.filter((c) => c.target).length;
  const surfacedCount = cols.filter((c) => c.target && c.target !== "company" && c.surfaced).length;

  const confidence = (i: number) => proposal.find((m) => m.index === i)?.confidence ?? 0;

  // mapped preview: header labels for kept columns, first rows underneath
  const keptCols = useMemo(() => cols.map((c, i) => ({ ...c, i })).filter((c) => c.target), [cols]);
  const labelFor = (target: string) => CANONICAL_FIELDS.find((f) => f.key === target)?.label ?? target;

  return (
    <form action={commit} className="space-y-6">
      {/* Column mapping table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
        <table className="data-table">
          <thead>
            <tr>
              <th>CSV column</th>
              <th>Detected</th>
              <th>Sample values</th>
              <th>Import as</th>
              <th className="text-center" title="Visible in the matrix and list views. Unsurfaced fields stay stored but hidden.">
                Surface
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h, i) => {
              const p = profiles[i];
              const c = cols[i];
              const conf = confidence(i);
              return (
                <tr key={i} className={c.target ? "" : "opacity-50"}>
                  <td className="font-medium">
                    {h}
                    {conf >= 0.9 && <span className="ml-1.5 text-micro font-semibold text-positive dark:text-green-400">auto</span>}
                    {conf > 0 && conf < 0.9 && <span className="ml-1.5 text-micro font-semibold text-amber-600 dark:text-amber-400">check</span>}
                  </td>
                  <td className="text-xs text-neutral-500">
                    {p?.type ?? "text"} · {Math.round((p?.fillRate ?? 0) * 100)}% filled
                  </td>
                  <td className="max-w-56 truncate text-xs text-neutral-400" title={p?.samples.join(" · ")}>
                    {p?.samples.slice(0, 2).join(" · ") || "—"}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <select
                        value={c.custom ? "__custom__" : c.target}
                        onChange={(e) => pick(i, e.target.value)}
                        className={input}
                      >
                        <option value="">Don&apos;t import</option>
                        {GROUPS.map((g) => (
                          <optgroup key={g} label={GROUP_LABEL[g]}>
                            {CANONICAL_FIELDS.filter((f) => f.group === g).map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        <option value="__custom__">Custom field (keep as-is)</option>
                      </select>
                      {c.custom && c.target !== "" && (
                        <input
                          value={c.target}
                          onChange={(e) => setCol(i, { target: customKey(e.target.value) || customKey(h) })}
                          className={`${input} w-36`}
                          title="Attribute key this column is stored under"
                        />
                      )}
                    </div>
                    <input type="hidden" name={`target_${i}`} value={c.target} />
                  </td>
                  <td className="text-center">
                    {c.target && c.target !== "company" ? (
                      <input
                        type="checkbox"
                        checked={c.surfaced}
                        onChange={(e) => setCol(i, { surfaced: e.target.checked })}
                        className="h-4 w-4"
                      />
                    ) : (
                      <span className="text-xs text-neutral-300 dark:text-neutral-700">—</span>
                    )}
                    {c.target && c.target !== "company" && c.surfaced && (
                      <input type="hidden" name="surfaced" value={c.target} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!companyMapped && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          Map one column to <strong>Company name</strong> — every row needs an account identity to import.
        </p>
      )}

      {/* Mapped preview */}
      {keptCols.length > 0 && preview.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Preview with your mapping · first {preview.length} of {rowCount.toLocaleString()} rows
          </h3>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
            <table className="data-table">
              <thead>
                <tr>
                  {keptCols.map((c) => (
                    <th key={c.i}>
                      {labelFor(c.target)}
                      {c.custom && <span className="ml-1 text-micro font-normal text-violet-600 dark:text-violet-400">custom</span>}
                      {c.target !== "company" && !c.surfaced && (
                        <span className="ml-1 text-micro font-normal text-neutral-400">hidden</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, ri) => (
                  <tr key={ri}>
                    {keptCols.map((c) => (
                      <td key={c.i} className="max-w-48 truncate text-xs" title={row[c.i]}>
                        {row[c.i] || <span className="text-neutral-300 dark:text-neutral-700">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Destination — a CRM export has none: rows become snapshots, evidence,
          and (only where the account holds nothing) synced-in opportunities. */}
      {kind === "crm" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          CRM lane: each row lands as a snapshot of what your CRM says (stage, amount, close date — verbatim, with
          provenance) plus first-party evidence. A live opportunity is created only where PursuitOS holds no open one;
          an existing record is never overwritten — disagreements surface on Today instead.
        </div>
      )}
      {kind === "enrichment" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Enrichment lane: recognized signal columns (installed technology, intent, IT spend, health scores, notes)
          land as third-party evidence with the vendor named as provenance — through the same quality gates as every
          other source, feeding the next propensity sweep. Firmographics fill only where your record is empty;
          nothing observed is ever overwritten, and no list or opportunity is created.
        </div>
      )}
      <div className={kind !== "book" ? "hidden" : "flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"}>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-500">List name</span>
          <input name="name" defaultValue={defaultName} className={`${input} w-64`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Category</span>
          <select name="category" defaultValue={defaultCategory} className={input}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Whose book is this?</span>
          <select name="partnerId" value={partnerSel} onChange={(e) => setPartnerSel(e.target.value)} className={input}>
            <option value="none">Ours (no partner)</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="new">New partner…</option>
          </select>
        </label>
        {partnerSel === "new" && (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Partner name</span>
              <input name="newPartner" placeholder="e.g. Meridian" className={`${input} w-44`} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Partner type</span>
              <select name="newPartnerType" defaultValue="reseller" className={input}>
                {PARTNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          disabled={!companyMapped}
          className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40"
        >
          {kind === "crm"
            ? `Sync CRM export · ${rowCount.toLocaleString()} rows`
            : kind === "enrichment"
              ? `Import enrichment signals · ${rowCount.toLocaleString()} rows`
              : `Import ${rowCount.toLocaleString()} rows · ${kept} fields (${surfacedCount} surfaced)`}
        </button>
        <button formAction={discard} formNoValidate className="text-sm font-medium text-red-700 hover:underline dark:text-red-400">
          Discard upload
        </button>
        <span className="text-label text-neutral-400">
          {kind === "crm"
            ? "Snapshots carry provenance; divergences from the live record surface on Today. Staged rows are deleted on sync or discard."
            : kind === "enrichment"
              ? "Signals land as vendor-attributed evidence; the next scoring sweep reads them. Staged rows are deleted on import or discard."
              : "The imported list lands in Pending review — nothing joins the matrix without your approval. Staged rows are deleted on import or discard."}
        </span>
      </div>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="filename" value={filename ?? ""} />
    </form>
  );
}
