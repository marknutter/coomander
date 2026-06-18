import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Coomander — Ship your next idea in days, not months";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Auto-generated Open Graph image for the landing page.
 * Uses Next.js ImageResponse (Satori) — no external image dependencies.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#059669",
          background: "linear-gradient(135deg, #059669 0%, #047857 50%, #065f46 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              backgroundColor: "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
            }}
          >
            🌱
          </div>
          <span
            style={{
              fontSize: "32px",
              fontWeight: 700,
              color: "white",
              letterSpacing: "-0.02em",
            }}
          >
            Coomander
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: "56px",
            fontWeight: 800,
            color: "white",
            textAlign: "center",
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
            maxWidth: "800px",
            marginBottom: "24px",
          }}
        >
          Ship your next idea in days, not months.
        </div>

        {/* Subheadline */}
        <div
          style={{
            fontSize: "22px",
            color: "rgba(255,255,255,0.8)",
            textAlign: "center",
            maxWidth: "600px",
            lineHeight: 1.5,
          }}
        >
          Production-ready Next.js starter with auth, database, payments, and email.
        </div>
      </div>
    ),
    { ...size }
  );
}
