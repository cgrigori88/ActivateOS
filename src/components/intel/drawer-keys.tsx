"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Thin client shell for the contextual intelligence drawer (§4): Esc closes (navigating to
 * closeHref without a scroll reset), and body scroll is locked while the drawer is open. All
 * drawer content is server-rendered; this only wires keyboard + scroll-lock behavior.
 */
export function DrawerKeys({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [closeHref, router]);
  return null;
}
