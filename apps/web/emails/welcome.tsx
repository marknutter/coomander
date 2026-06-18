import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface WelcomeEmailProps {
  appName?: string;
  appUrl?: string;
}

export default function WelcomeEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
}: WelcomeEmailProps) {
  return (
    <EmailLayout preview={`Welcome to ${appName}`} appName={appName} appUrl={appUrl}>
      <Text style={heading}>Welcome to {appName} 👋</Text>
      <Text style={para}>Thanks for signing up. Your account is ready.</Text>
      <CtaButton href={`${appUrl}/app`}>Get started</CtaButton>
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
