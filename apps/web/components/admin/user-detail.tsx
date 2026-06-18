"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Button, Modal, Input } from "@/components/ui";
import { PlanOverrideForm } from "./plan-override-form";
import { toast } from "@/lib/use-toast";

export interface UserDetail {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  effectivePlan: string;
  created_at: string;
  isAdmin: boolean;
  subscription_status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  provider: string;
  emailVerified: boolean;
  disabled: boolean;
  planOverride: {
    plan: string;
    reason: string | null;
    expiresAt: string | null;
    createdAt: string | null;
    grantedBy: string | null;
    active: boolean;
  } | null;
  itemsCount: number;
}

interface UserDetailProps {
  user: UserDetail;
}

export function UserDetailView({ user: initialUser }: UserDetailProps) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [statusLoading, setStatusLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  const refreshUser = useCallback(async () => {
    const res = await fetch(`/api/admin/users/${user.id}`);
    if (res.ok) {
      const json = await res.json();
      setUser(json.data);
    }
  }, [user.id]);

  async function toggleDisabled() {
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !user.disabled }),
      });
      if (res.ok) {
        await refreshUser();
        toast.success(user.disabled ? "User enabled" : "User disabled");
      } else {
        toast.error("Failed to update user status");
      }
    } finally {
      setStatusLoading(false);
    }
  }

  async function sendResetPassword() {
    setResetLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-pw`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Password reset email sent");
      } else {
        toast.error("Failed to send password reset email");
      }
    } finally {
      setResetLoading(false);
    }
  }

  async function sendEmail() {
    setEmailLoading(true);
    setEmailError("");
    try {
      const res = await fetch(`/api/admin/users/${user.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: emailSubject, body: emailBody }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEmailError(json.error ?? "Failed to send email");
        return;
      }
      setEmailModalOpen(false);
      setEmailSubject("");
      setEmailBody("");
      toast.success("Email sent");
    } finally {
      setEmailLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile */}
      <Card title="User Profile">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Email</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-100">{user.email}</dd>
          </div>
          {user.name && (
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Name</dt>
              <dd>{user.name}</dd>
            </div>
          )}
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Provider</dt>
            <dd>{user.provider}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Email Verified</dt>
            <dd>
              <Badge variant={user.emailVerified ? "success" : "warning"}>
                {user.emailVerified ? "Yes" : "No"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Admin</dt>
            <dd>{user.isAdmin ? <Badge variant="info">Admin</Badge> : "No"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Status</dt>
            <dd>
              <Badge variant={user.disabled ? "danger" : "success"}>
                {user.disabled ? "Disabled" : "Active"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Joined</dt>
            <dd>{new Date(user.created_at).toLocaleString()}</dd>
          </div>
        </dl>
      </Card>

      {/* Subscription */}
      <Card title="Subscription">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Plan</dt>
            <dd>
              <Badge variant={user.plan === "pro" ? "pro" : "default"}>{user.plan}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Effective Plan</dt>
            <dd>
              <Badge variant={user.effectivePlan === "pro" ? "pro" : "default"}>
                {user.effectivePlan}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Subscription Status</dt>
            <dd>{user.subscription_status}</dd>
          </div>
          {user.stripeCustomerId && (
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Stripe Customer</dt>
              <dd className="font-mono text-xs">{user.stripeCustomerId}</dd>
            </div>
          )}
          {user.stripeSubscriptionId && (
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Stripe Subscription</dt>
              <dd className="font-mono text-xs">{user.stripeSubscriptionId}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Usage */}
      <Card title="Usage">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Items</dt>
            <dd className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {user.itemsCount}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Plan Override */}
      <Card
        title="Plan Override"
        headerAction={
          user.planOverride?.active ? (
            <Badge variant="warning">Active Override</Badge>
          ) : null
        }
      >
        {user.planOverride && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm space-y-1">
            <p>
              <span className="text-zinc-500">Current override:</span>{" "}
              <strong>{user.planOverride.plan}</strong>
            </p>
            {user.planOverride.reason && (
              <p>
                <span className="text-zinc-500">Reason:</span> {user.planOverride.reason}
              </p>
            )}
            {user.planOverride.expiresAt && (
              <p>
                <span className="text-zinc-500">Expires:</span>{" "}
                {new Date(user.planOverride.expiresAt).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
        <PlanOverrideForm
          userId={user.id}
          currentOverride={user.planOverride}
          onSuccess={refreshUser}
        />
      </Card>

      {/* Actions */}
      <Card title="Account Actions">
        <div className="flex flex-wrap gap-3">
          <Button
            variant={user.disabled ? "primary" : "danger"}
            loading={statusLoading}
            onClick={toggleDisabled}
          >
            {user.disabled ? "Enable Account" : "Disable Account"}
          </Button>
          <Button
            variant="secondary"
            loading={resetLoading}
            onClick={sendResetPassword}
          >
            Send Password Reset
          </Button>
          <Button variant="secondary" onClick={() => setEmailModalOpen(true)}>
            Send Email
          </Button>
          <Button variant="ghost" onClick={() => router.back()}>
            Back
          </Button>
        </div>
      </Card>

      {/* Email Modal */}
      <Modal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        title="Send Admin Email"
        maxWidth="max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEmailModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={emailLoading} onClick={sendEmail}>
              Send Email
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Subject"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Email subject..."
            required
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Body
            </label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={6}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="Email body..."
            />
          </div>
          {emailError && <p className="text-sm text-red-600 dark:text-red-400">{emailError}</p>}
        </div>
      </Modal>
    </div>
  );
}
