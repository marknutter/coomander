import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface PasswordResetEmailProps {
  appName?: string;
  appUrl?: string;
  resetUrl?: string;
}

export default function PasswordResetEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
  resetUrl = "https://YOUR_DOMAIN/reset",
}: PasswordResetEmailProps) {
  return (
    <EmailLayout preview={`Reset your password — ${appName}`} appName={appName} appUrl={appUrl}>
      <Text style={heading}>Reset your password</Text>
      <Text style={para}>
        We received a request to reset the password for your {appName} account.
      </Text>
      <CtaButton href={resetUrl}>Reset Password</CtaButton>
      <Text style={small}>
        This link expires in <strong>1 hour</strong>. If you didn&apos;t request
        this, ignore this email.
      </Text>
    </EmailLayout>
  );
}

const heading: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: 24,
  fontWeight: 700,
  color: "#111827",
  letterSpacing: "-0.5px",
};

const para: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 15,
  color: "#4b5563",
  lineHeight: "1.7",
};

const small: React.CSSProperties = {
  margin: "20px 0 0",
  fontSize: 13,
  color: "#9ca3af",
  lineHeight: "1.6",
};
