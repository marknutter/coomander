import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface SubscriptionCancelledEmailProps {
  appName?: string;
  appUrl?: string;
  unsubscribeUrl?: string;
}

export default function SubscriptionCancelledEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
  unsubscribeUrl,
}: SubscriptionCancelledEmailProps) {
  return (
    <EmailLayout
      preview={`Subscription cancelled — ${appName}`}
      appName={appName}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>Your subscription has been cancelled</Text>
      <Text style={para}>
        Your {appName} Pro subscription has ended. You still have access to free
        features.
      </Text>
      <Text style={para}>
        Changed your mind? You can resubscribe anytime.
      </Text>
      <CtaButton href={`${appUrl}/app/billing`}>Resubscribe</CtaButton>
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
