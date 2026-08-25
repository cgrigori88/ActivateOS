"use client";

/**
 * Last-resort boundary (errors in the root layout itself). Self-contained —
 * it renders its own <html>, so styles are inline and dependency-free.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fafaf9",
          color: "#1c1917",
        }}
      >
        <div style={{ maxWidth: 480, padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#57534e", lineHeight: 1.6 }}>
            The page hit an unexpected error. Your data is unaffected — retry, or go back to the app.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              onClick={reset}
              style={{
                background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 6,
                padding: "8px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a href="/" style={{ fontSize: 14, alignSelf: "center", color: "#1d4ed8" }}>Back to Today</a>
          </div>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#a8a29e", marginTop: 16 }}>
              Error reference: <span style={{ fontFamily: "monospace" }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
