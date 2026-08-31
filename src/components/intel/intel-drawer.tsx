import Link from "next/link";
import type { AccountIntel } from "@/lib/accounts/intel";
import { AccountIntelPane } from "@/components/accounts/intel-pane";
import { DrawerKeys } from "./drawer-keys";

/**
 * Contextual intelligence drawer (scale-disclosure §4 / R7). A right-side overlay opened from Today
 * or Pipeline via the `?drawer=<companyId>` URL param — deep-linkable and SERVER-RENDERED (its body
 * exists only when the param is present, so no confidential field is ever serialized to the client
 * while the drawer is closed). The underlying room stays mounted beneath the scrim; opening/closing
 * carries `scroll={false}`, so page context, filters, sort, scope, and scroll position are preserved.
 *
 * Disclosure: the body reuses getAccountIntel, which reads the viewer's own RLS-scoped canonical
 * objects — the same permitted projection the destination account/pursuit detail page renders.
 */
export function IntelDrawer({ intel, closeHref }: { intel: AccountIntel; closeHref: string }) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${intel.legalName} intelligence`}>
      <DrawerKeys closeHref={closeHref} />
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-neutral-950/50 backdrop-blur-[3px]" />
      {/* Opaque reading sheet: depth comes from the dimmed/blurred page + the float shadow, never from
          letting page text bleed through. Glass treatment stays on the left-edge chrome only. */}
      <aside
        className="absolute inset-y-0 right-0 flex w-[min(440px,94vw)] flex-col overflow-y-auto border-l p-4 scroll-thin"
        style={{ background: "var(--surface-sheet)", borderColor: "var(--border-emphasis)", boxShadow: "var(--shadow-float)" }}
      >
        <AccountIntelPane intel={intel} closeHref={closeHref} flat />
      </aside>
    </div>
  );
}
