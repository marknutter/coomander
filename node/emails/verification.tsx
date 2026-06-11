import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface VerificationEmailProps {
  appName?: string;
  appUrl?: string;
  verificationUrl?: string;
}

export default function VerificationEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
  verificationUrl = "https://YOUR_DOMAIN/verify",
}: VerificationEmailProps) {
  return (
    <EmailLayout preview={`Verify your email — ${appName}`} appName={appName} appUrl={appUrl}>
      <Text style={heading}>Verify your email address</Text>
      <Text style={para}>
        Click below to verify your email and activate your {appName} account.
      </Text>
      <CtaButton href={verificationUrl}>Verify Email</CtaButton>
      <Text style={small}>
        This link expires in <strong>24 hours</strong>. If you didn&apos;t create
        an account, ignore this email.
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
