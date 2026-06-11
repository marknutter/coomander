import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
  Preview,
} from "@react-email/components";
import * as React from "react";

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
  appName?: string;
  appUrl?: string;
  unsubscribeUrl?: string;
}

export function EmailLayout({
  preview,
  children,
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
  unsubscribeUrl,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Emerald header */}
          <Section style={header}>
            <Text style={headerText}>{appName}</Text>
          </Section>

          {/* Body */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Hr style={divider} />
          <Section style={footer}>
            <Text style={footerText}>
              You received this email because you have an account with{" "}
              {appName}.
              <br />
              &copy; {new Date().getFullYear()} {appName} &middot;{" "}
              <Link href={appUrl} style={footerLink}>
                {appUrl}
              </Link>
              {unsubscribeUrl && (
                <>
                  <br />
                  <Link href={unsubscribeUrl} style={unsubLink}>
                    Unsubscribe
                  </Link>
                </>
              )}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const body: React.CSSProperties = {
  margin: 0,
  padding: 0,
  background: "#f4f4f5",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

const container: React.CSSProperties = {
  maxWidth: 560,
  margin: "40px auto",
  background: "#ffffff",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const header: React.CSSProperties = {
  background: "#10b981",
  padding: "28px 40px",
  textAlign: "left" as const,
};

const headerText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "-0.3px",
  margin: 0,
};

const content: React.CSSProperties = {
  padding: "40px 40px 32px",
};

const divider: React.CSSProperties = {
  borderTop: "1px solid #f0f0f0",
  margin: 0,
};

const footer: React.CSSProperties = {
  padding: "20px 40px 32px",
};

const footerText: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "#9ca3af",
  lineHeight: "1.6",
};

const footerLink: React.CSSProperties = {
  color: "#10b981",
  textDecoration: "none",
};

const unsubLink: React.CSSProperties = {
  color: "#9ca3af",
  textDecoration: "underline",
};
