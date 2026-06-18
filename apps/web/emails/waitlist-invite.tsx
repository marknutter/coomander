import { Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CtaButton } from "./components/cta-button";
import * as React from "react";

interface WaitlistInviteEmailProps {
  appName?: string;
  appUrl?: string;
  inviteCode?: string;
  unsubscribeUrl?: string;
}

export default function WaitlistInviteEmail({
  appName = "Coomander",
  appUrl = "https://YOUR_DOMAIN",
  inviteCode = "ABC123",
  unsubscribeUrl,
}: WaitlistInviteEmailProps) {
  const signupUrl = `${appUrl}/auth?tab=signup&invite=${encodeURIComponent(inviteCode)}`;

  return (
    <EmailLayout
      preview={`You're invited to ${appName}!`}
      appName={appName}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>You&apos;re invited!</Text>
      <Text style={para}>
        Great news — you&apos;ve been selected for early access to {appName}.
        Use the link below to create your account.
      </Text>
      <CtaButton href={signupUrl}>Accept Invite</CtaButton>
      <Text style={small}>
        Your invite code: <strong>{inviteCode}</strong>
        <br />
        This invite is single-use. If you didn&apos;t sign up for {appName}, you
        can safely ignore this email.
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
