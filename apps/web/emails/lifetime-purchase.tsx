import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface LifetimePurchaseEmailProps {
  appName?: string;
  appUrl?: string;
}

export default function LifetimePurchaseEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
}: LifetimePurchaseEmailProps) {
  return (
    <EmailLayout preview={`You're a lifetime member! — ${appName}`} appName={appName} appUrl={appUrl}>
      <Text style={heading}>You&apos;re a lifetime member! 🎉</Text>
      <Text style={para}>
        Thank you for purchasing a <strong>Lifetime Deal</strong>. You now have
        permanent access to all {appName} Pro features — no recurring payments,
        no expiry.
      </Text>
      <CtaButton href={`${appUrl}/app`}>Go to app</CtaButton>
      <Text style={small}>
        This is a one-time purchase. You will not be billed again.
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
