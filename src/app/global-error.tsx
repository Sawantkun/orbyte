"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0B0C10", color: "#F5F5F7", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>Orbyte hit an unexpected error</h1>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 14px", borderRadius: 8, border: "1px solid #252A36", background: "#141720", color: "inherit", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
