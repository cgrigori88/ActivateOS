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
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-neutral-950/40 backdrop-blur-[2px]" />
      <div className="absolute inset-y-0 right-0 w-[min(440px,94vw)] overflow-y-auto p-3 scroll-thin">
        <AccountIntelPane intel={intel} closeHref={closeHref} />
      </div>
    </div>
  );
}
