"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <h1>Something went wrong</h1>
          <p>Please try again. If the problem continues, contact your administrator.</p>
          <button onClick={() => reset()} style={{ padding: "8px 16px", marginTop: 12 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
