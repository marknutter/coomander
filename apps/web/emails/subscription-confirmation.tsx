import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface SubscriptionConfirmationEmailProps {
  appName?: string;
  appUrl?: string;
  plan?: string;
  unsubscribeUrl?: string;
}

export default function SubscriptionConfirmationEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
  plan = "Pro",
  unsubscribeUrl,
}: SubscriptionConfirmationEmailProps) {
  return (
    <EmailLayout
      preview={`You're on ${plan} 🎉 — ${appName}`}
      appName={appName}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>You&apos;re on Pro 🎉</Text>
      <Text style={para}>
        Your <strong>{plan}</strong> subscription is now active. Enjoy full
        access to all {appName} features.
      </Text>
      <CtaButton href={`${appUrl}/app`}>Go to app</CtaButton>
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
