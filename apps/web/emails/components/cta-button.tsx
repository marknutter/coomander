import { Button } from "@react-email/components";
import * as React from "react";

interface CtaButtonProps {
  href: string;
  children: React.ReactNode;
}

export function CtaButton({ href, children }: CtaButtonProps) {
  return (
    <Button href={href} style={buttonStyle}>
      {children}
    </Button>
  );
}

const buttonStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 24,
  padding: "14px 28px",
  background: "#10b981",
  color: "#ffffff",
  fontSize: 15,
  fontWeight: 600,
  textDecoration: "none",
  borderRadius: 8,
};
