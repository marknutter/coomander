import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface PaymentFailedEmailProps {
  appName?: string;
  appUrl?: string;
  unsubscribeUrl?: string;
}

export default function PaymentFailedEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
  unsubscribeUrl,
}: PaymentFailedEmailProps) {
  return (
    <EmailLayout
      preview={`Payment failed — ${appName}`}
      appName={appName}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>Payment failed</Text>
      <Text style={para}>
        We couldn&apos;t process your latest payment for {appName} Pro. Please
        update your payment method to avoid service interruption.
      </Text>
      <CtaButton href={`${appUrl}/app/billing`}>Update Payment</CtaButton>
      <Text style={small}>
        If this was a mistake, your card issuer may have more details.
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
