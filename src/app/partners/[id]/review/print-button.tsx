"use client";

/** Print / save-as-PDF trigger for the partnership review (task #83 follow-up). */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white print:hidden"
    >
      Print / save as PDF
    </button>
  );
}
