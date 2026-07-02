"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Send, Eye, ArrowLeft, Mail, MousePointerClick, AlertTriangle, CalendarClock, XCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/use-toast";
import { cn } from "@/lib/cn";
import { AudiencePicker, parseAudienceFilter, ALL_AUDIENCE, type AudienceFilter } from "@/components/admin/audience-picker";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  preview_text: string;
  html_content: string;
  status: string;
  audience_filter: string;
  recipient_count: number;
  sent_count: number;
  batches_total: number;
  batches_done: number;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  sending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  sent: "bg-accent text-primary ",
  failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [analytics, setAnalytics] = useState<Record<string, number> | null>(null);

  // Editable fields
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [htmlContent, setHtmlContent] = useState("");

  // Audience + recipient count (#596/#222)
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>(ALL_AUDIENCE);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [recipientDescription, setRecipientDescription] = useState("");
  const [countLoading, setCountLoading] = useState(false);

  // Schedule / cancel (#597/#222)
  const [scheduleInput, setScheduleInput] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Not found");
      const c = json.data as Campaign;
      setCampaign(c);
      setName(c.name);
      setSubject(c.subject);
      setPreviewText(c.preview_text ?? "");
      setHtmlContent(c.html_content);
      setAudienceFilter(parseAudienceFilter(c.audience_filter));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchRecipientCount = useCallback(async (filter: AudienceFilter) => {
    setCountLoading(true);
    try {
      const res = await fetch("/api/admin/campaigns/audience-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience_filter: filter }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to resolve audience");
      setRecipientCount(json.data.count);
      setRecipientDescription(json.data.description);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resolve audience");
    } finally {
      setCountLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/analytics`);
      const json = await res.json();
      if (res.ok) setAnalytics(json.data);
    } catch {
      // Analytics are optional — fail silently
    }
  }, [id]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  useEffect(() => {
    if (campaign && campaign.status === "sent") {
      fetchAnalytics();
    }
  }, [campaign, fetchAnalytics]);

  // No live-progress channel yet (that's grafted on by a separate realtime
  // sync slice) — poll while a send is in flight so batch progress advances
  // without a manual refresh.
  const campaignStatus = campaign?.status;
  useEffect(() => {
    if (campaignStatus !== "sending") return;
    const t = setInterval(() => {
      fetchCampaign();
    }, 4000);
    return () => clearInterval(t);
  }, [campaignStatus, fetchCampaign]);

  // Live recipient count — re-resolved whenever the audience filter changes
  // (light debounce so rapid tag clicks don't fire a request per click).
  useEffect(() => {
    if (!campaign) return;
    const t = setTimeout(() => {
      fetchRecipientCount(audienceFilter);
    }, 300);
    return () => clearTimeout(t);
  }, [campaign, audienceFilter, fetchRecipientCount]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          preview_text: previewText.trim(),
          html_content: htmlContent,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setCampaign(json.data);
      toast.success("Campaign saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleAudienceChange = async (filter: AudienceFilter) => {
    setAudienceFilter(filter);
    if (!campaign || campaign.status !== "draft") return;
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience_filter: JSON.stringify(filter) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update audience");
      setCampaign(json.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update audience");
    }
  };

  const handleSchedule = async () => {
    if (!scheduleInput) {
      toast.error("Pick a date and time to schedule for");
      return;
    }
    const when = new Date(scheduleInput);
    if (Number.isNaN(when.getTime())) {
      toast.error("Invalid date/time");
      return;
    }
    if (when.getTime() <= Date.now()) {
      toast.error("Scheduled time must be in the future");
      return;
    }
    setScheduling(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: when.toISOString() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Schedule failed");
      setCampaign(json.data);
      setScheduleInput("");
      toast.success("Campaign scheduled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Schedule failed");
    } finally {
      setScheduling(false);
    }
  };

  const handleCancelSchedule = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/cancel`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Cancel failed");
      setCampaign(json.data);
      toast.success("Schedule cancelled — campaign returned to draft");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/preview`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      toast.success(`Preview sent to ${json.data.to}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSend = async () => {
    if (!confirm("Send this campaign to all active subscribers? This cannot be undone.")) {
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/send`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Send failed");
      setCampaign(json.data);
      toast.success("Campaign sent!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-zinc-500">Loading campaign...</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6">
        <p className="text-red-500">Campaign not found</p>
      </div>
    );
  }

  const isDraft = campaign.status === "draft";
  const isScheduled = campaign.status === "scheduled";
  const isSending = campaign.status === "sending";

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/admin/campaigns")}
          className="p-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex-1">
          {campaign.name}
        </h1>
        <span
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium",
            statusColors[campaign.status] ?? statusColors.draft
          )}
        >
          {campaign.status}
        </span>
      </div>

      {/* Audience + live recipient count (#596/#222) */}
      <div className="mb-6 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <AudiencePicker
          value={audienceFilter}
          onChange={handleAudienceChange}
          readOnly={!isDraft}
          description={recipientDescription}
        />
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {countLoading
            ? "Calculating recipients..."
            : recipientCount !== null
              ? `Will send to ${recipientCount} subscriber${recipientCount === 1 ? "" : "s"}`
              : null}
        </p>
      </div>

      {/* Schedule / cancel / reschedule (#597/#222) — draft can schedule, scheduled can cancel or reschedule */}
      {(isDraft || isScheduled) && (
        <div className="mb-6 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 space-y-3">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Schedule</p>
          {isScheduled && campaign.scheduled_at && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Scheduled to send on {new Date(campaign.scheduled_at).toLocaleString()}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="datetime-local"
              value={scheduleInput}
              onChange={(e) => setScheduleInput(e.target.value)}
              className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
            />
            <Button
              variant="secondary"
              loading={scheduling}
              icon={<CalendarClock className="w-4 h-4" />}
              onClick={handleSchedule}
            >
              {isScheduled ? "Reschedule" : "Schedule"}
            </Button>
            {isScheduled && (
              <Button
                variant="danger"
                loading={cancelling}
                icon={<XCircle className="w-4 h-4" />}
                onClick={handleCancelSchedule}
              >
                Cancel Schedule
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Editor (draft only) */}
      {isDraft ? (
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Campaign Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Subject Line
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Preview Text
            </label>
            <input
              type="text"
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="Short preview shown in inbox"
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              HTML Content
            </label>
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              rows={16}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm font-mono focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>

          <div className="flex gap-3">
            <Button variant="primary" loading={saving} onClick={handleSave}>
              Save Draft
            </Button>
            <Button
              variant="secondary"
              loading={previewing}
              icon={<Eye className="w-4 h-4" />}
              onClick={handlePreview}
            >
              Send Preview
            </Button>
            <Button
              variant="primary"
              loading={sending}
              icon={<Send className="w-4 h-4" />}
              onClick={handleSend}
            >
              Send Campaign
            </Button>
          </div>
        </div>
      ) : (
        /* Read-only view for sending/sent/failed campaigns */
        <div className="space-y-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Subject</p>
              <p className="text-zinc-900 dark:text-zinc-100">{campaign.subject}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Sent</p>
              <p className="text-zinc-900 dark:text-zinc-100">
                {campaign.sent_at
                  ? new Date(campaign.sent_at).toLocaleString()
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Recipients</p>
              <p className="text-zinc-900 dark:text-zinc-100">
                {campaign.sent_count || campaign.recipient_count || "—"}
              </p>
            </div>
          </div>

          {/* Sending progress — polled while status='sending' (no live channel yet) */}
          {isSending && (
            <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"
                aria-hidden="true"
              />
              Sending in progress: {campaign.sent_count} sent
              {campaign.batches_total > 0
                ? ` (batch ${campaign.batches_done} of ${campaign.batches_total})`
                : ""}
              .
            </p>
          )}

          {/* Analytics */}
          {analytics && (
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Analytics
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: "Delivered", value: analytics.delivered, icon: Mail },
                  { label: "Opened", value: analytics.opened, icon: Eye },
                  { label: "Clicked", value: analytics.clicked, icon: MousePointerClick },
                  { label: "Bounced", value: analytics.bounced, icon: AlertTriangle },
                  { label: "Complained", value: analytics.complained, icon: AlertTriangle },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-center"
                  >
                    <stat.icon className="w-4 h-4 mx-auto mb-1 text-zinc-400" />
                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {stat.value}
                    </p>
                    <p className="text-xs text-zinc-500">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* HTML preview */}
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Email Content
            </p>
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
              <iframe
                srcDoc={campaign.html_content}
                className="w-full h-[500px] bg-white"
                title="Email preview"
                sandbox=""
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
