"use client";

/**
 * /app/cadence — Cadence ops dashboard (#152). The AI agent that drives this
 * state is "Coomander" (lib/coomander, /api/coomander); the user-facing surface
 * is "Cadence".
 *
 * Internal-tools-grade (no marketing polish). Shows the TodayModel — pillars
 * with beats + status, the content pipeline, urgent procurement split by
 * category — and allows inline edits: add pillar/beat, edit a beat target,
 * transition content state, add a procurement item. A richer UI lands later.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/use-toast";

const CONTENT_STATES = ["drafted", "shot", "approved", "uploaded_to_edit", "edited", "scheduled", "shipped"] as const;
const CADENCE_KINDS = ["daily", "weekly", "window", "daily_vlog_buffer"] as const;
const PILLAR_KINDS = ["content", "wall", "procurement", "engagement", "admin"] as const;

// Cadence-ping presets (nag frequency). Ordered least → most frequent; mirrors
// NAG_FREQUENCIES / PRESET_SLOTS server-side. "off" silences all scheduled pings.
const NAG_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "No scheduled pings. You can still chat anytime." },
  { value: "light", label: "Light", desc: "Morning and evening only." },
  { value: "moderate", label: "Moderate", desc: "Morning, midday, and evening." },
  { value: "tight", label: "Tight", desc: "All four daily touchpoints (default)." },
];

type Json = Record<string, unknown>;

// Minimal shapes (the API returns more; we read what we render).
interface TodayBeat {
  beat: { id: string; name: string; cadence_kind: string; target_count: number; platform_specific: string | null; subtype: string | null };
  expected_today: number;
  actual_today: number;
  status: string;
  window_progress?: { days_remaining: number; completion: number };
  buffer_status?: { current_days: number; goal_days: number; healthy: boolean };
  streak_days?: number;
}
interface TodayModel {
  date: string;
  pillars: Array<{ pillar: { id: string; name: string; kind: string }; beats: TodayBeat[] }>;
  content_pipeline: Record<string, number>;
  content_cushion_days: number;
  procurement_urgent: { shoot_prep: Array<Json>; business_admin: Array<Json> };
  day_quality: string | null;
  overall_state: string;
}
interface ContentItem { id: string; title: string; current_state: string; beat_id: string | null }

const STATUS_CLASS: Record<string, string> = {
  on_pace: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  ahead: "bg-emerald-100 text-emerald-800",
  behind: "bg-red-100 text-red-800",
  untouched: "bg-gray-200 text-gray-700",
  buffer_healthy: "bg-green-100 text-green-800",
  buffer_low: "bg-amber-100 text-amber-800",
};

async function api(method: string, path: string, body?: Json): Promise<Json> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);
  return data;
}

export default function CoomanderPage() {
  const [model, setModel] = useState<TodayModel | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [latestReviewWeek, setLatestReviewWeek] = useState<string | null>(null);
  const [nagFrequency, setNagFrequency] = useState<string>("tight");
  const [savingNag, setSavingNag] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const en = await api("GET", "/api/coomander/enable");
      setEnabled(en.enabled as boolean);
      if (!en.enabled) { setLoading(false); return; }
      const [t, c, s, lr] = await Promise.all([
        api("GET", "/api/coomander/today"),
        api("GET", "/api/coomander/content"),
        api("GET", "/api/coomander/settings"),
        api("GET", "/api/coomander/weekly-review/latest").catch(() => ({ review: null })),
      ]);
      setModel(t.model as TodayModel);
      setContent((c.content as ContentItem[]) ?? []);
      const settings = s.settings as { defaultsBannerDismissedAt: number | null; nagFrequency: string };
      setBannerDismissed(settings.defaultsBannerDismissedAt != null);
      setNagFrequency(settings.nagFrequency ?? "tight");
      const rev = lr.review as { week_ending: string } | null;
      setLatestReviewWeek(rev?.week_ending ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enableOps = async () => {
    setEnabling(true);
    try { await api("POST", "/api/coomander/enable"); toast.success("Coomander enabled, defaults seeded"); await refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setEnabling(false); }
  };

  const dismissBanner = async () => {
    setBannerDismissed(true);
    try { await api("PATCH", "/api/coomander/settings", { dismissBanner: true }); } catch { /* best effort */ }
  };

  const saveNagFrequency = async (value: string) => {
    if (value === nagFrequency || savingNag) return;
    const prev = nagFrequency;
    setNagFrequency(value); // optimistic
    setSavingNag(true);
    try {
      await api("PATCH", "/api/coomander/settings", { nagFrequency: value });
      toast.success(value === "off" ? "Scheduled pings turned off" : `Cadence pings set to ${value}`);
    } catch (e) {
      setNagFrequency(prev); // revert on failure
      toast.error((e as Error).message);
    } finally {
      setSavingNag(false);
    }
  };

  const overallClass =
    model?.overall_state === "green" ? "text-green-600" : model?.overall_state === "red" ? "text-red-600" : "text-amber-600";

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/app" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Button variant="secondary" onClick={refresh}>Refresh</Button>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Cadence</h1>
        {model && (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {model.date} · <span className={overallClass}>{model.overall_state.toUpperCase()}</span>
            {model.day_quality === "bad" && <span className="ml-2 text-red-600">bad day</span>}
            <span className="ml-2">cushion: {model.content_cushion_days}d</span>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-red-900 bg-red-100 rounded p-3">{error}</div>}
      {loading && <Skeleton className="h-40 w-full" />}

      {enabled === false && !loading && (
        <Card title="Enable Coomander">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            Turn on Coomander to seed the validated OF playbook (reels, trials, wall, lives, PPV, procurement) and start daily accountability pings.
          </p>
          <Button onClick={enableOps} disabled={enabling}>{enabling ? "Enabling…" : "Enable Coomander"}</Button>
        </Card>
      )}

      {model && (
        <>
          {!bannerDismissed && (
            <div className="flex items-start gap-3 text-sm bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded p-3 text-blue-900 dark:text-blue-100">
              <span className="flex-1">
                These cadence defaults match the OF playbook our research validated. They&apos;re meant to be edited if your workflow differs. Tap any beat to adjust targets or remove it.
              </span>
              <button onClick={dismissBanner} aria-label="Dismiss" className="text-blue-700 dark:text-blue-300 hover:opacity-70">×</button>
            </div>
          )}
          {latestReviewWeek && (
            <Link href={`/app/cadence/review/${latestReviewWeek}`} className="block text-sm text-blue-700 dark:text-blue-300 hover:underline">
              View latest weekly review ({latestReviewWeek}) →
            </Link>
          )}

          {/* Cadence pings (nag frequency) */}
          <Card title="Cadence pings">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              How often Coomander checks in over Telegram. Choose <strong>Off</strong> to pause scheduled pings — chat still works anytime.
            </p>
            <div className="space-y-2">
              {NAG_OPTIONS.map((o) => {
                const active = nagFrequency === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => saveNagFrequency(o.value)}
                    disabled={savingNag}
                    aria-pressed={active}
                    className={`w-full text-left rounded-lg border p-3 transition disabled:opacity-60 ${
                      active
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-500"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{o.label}</span>
                      {active && <span className="text-xs font-medium text-blue-600 dark:text-blue-300">Current</span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{o.desc}</div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Pillars + beats */}
          <Card title="Cadence">
            {model.pillars.length === 0 && <p className="text-sm text-gray-500">No pillars yet. Add one below.</p>}
            <div className="space-y-4">
              {model.pillars.map((p) => (
                <div key={p.pillar.id}>
                  <div className="font-medium text-gray-900 dark:text-gray-100">{p.pillar.name} <span className="text-xs text-gray-400">({p.pillar.kind})</span></div>
                  <div className="mt-1 space-y-1">
                    {p.beats.length === 0 && <p className="text-xs text-gray-400">No beats.</p>}
                    {p.beats.map((b) => <BeatRow key={b.beat.id} b={b} onChange={refresh} />)}
                  </div>
                </div>
              ))}
            </div>
            <AddBeat pillars={model.pillars.map((p) => p.pillar)} onAdded={refresh} />
          </Card>

          {/* Content pipeline */}
          <Card title="Content pipeline">
            <div className="flex flex-wrap gap-3 text-sm">
              {CONTENT_STATES.map((s) => (
                <span key={s} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
                  {s}: <strong>{model.content_pipeline[s] ?? 0}</strong>
                </span>
              ))}
              <span className="px-2 py-1 rounded bg-green-100 text-green-800">shipped today: <strong>{model.content_pipeline.shipped_today ?? 0}</strong></span>
            </div>
            <div className="mt-3 space-y-1">
              {content.map((c) => <ContentRow key={c.id} c={c} onChange={refresh} />)}
            </div>
            <AddContent onAdded={refresh} />
          </Card>

          {/* Procurement */}
          <Card title="Urgent procurement">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <ProcCol title="Shoot prep" items={model.procurement_urgent.shoot_prep} />
              <ProcCol title="Business admin" items={model.procurement_urgent.business_admin} />
            </div>
            <AddProcurement onAdded={refresh} />
          </Card>

          <AddPillar onAdded={refresh} />
        </>
      )}
    </div>
  );
}

function BeatRow({ b, onChange }: { b: TodayBeat; onChange: () => void }) {
  const [target, setTarget] = useState(String(b.beat.target_count));
  const [saving, setSaving] = useState(false);
  const [captureNote, setCaptureNote] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const isBuffer = b.beat.cadence_kind === "daily_vlog_buffer";

  const save = async () => {
    setSaving(true);
    try {
      await api("PATCH", "/api/coomander/beats", { id: b.beat.id, targetCount: Number(target) });
      toast.success("Beat updated");
      onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const capture = async () => {
    try {
      const r = await api("POST", "/api/coomander/drops", { beatId: b.beat.id, kind: "captured", platform: b.beat.platform_specific ?? undefined, notes: captureNote || undefined });
      const ws = ((r.warnings as Array<{ message: string }>) ?? []).map((w) => w.message);
      setWarnings(ws);
      setCaptureNote("");
      if (ws.length) toast.error(`${ws.length} wall warning(s)`); else toast.success("Captured");
      onChange();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_CLASS[b.status] ?? "bg-gray-100 text-gray-700"}`}>{b.status}</span>
        <span className="text-gray-900 dark:text-gray-100">{b.beat.name}</span>
        <span className="text-xs text-gray-400">{b.beat.cadence_kind}{b.beat.platform_specific ? `·${b.beat.platform_specific}` : ""}{b.beat.subtype ? `·${b.beat.subtype}` : ""}</span>
        {b.buffer_status ? (
          <span className="text-xs text-gray-500">buffer {b.buffer_status.current_days}/{b.buffer_status.goal_days}d</span>
        ) : b.window_progress ? (
          <span className="text-xs text-gray-500">{Math.round(b.window_progress.completion * 100)}% · {b.window_progress.days_remaining}d left</span>
        ) : (
          <span className="text-xs text-gray-500">{b.actual_today}/{b.expected_today} today{b.streak_days ? ` · ${b.streak_days}d streak` : ""}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Input value={target} onChange={(e) => setTarget(e.target.value)} className="w-16 text-gray-900 dark:text-gray-100" />
          <Button size="sm" variant="secondary" onClick={save} disabled={saving}>Set</Button>
        </span>
      </div>
      {isBuffer && (
        <div className="mt-1 ml-6 flex items-center gap-1">
          <Input placeholder="Log a wall capture (note)…" value={captureNote} onChange={(e) => setCaptureNote(e.target.value)} className="text-gray-900 dark:text-gray-100" />
          <Button size="sm" variant="secondary" onClick={capture}>Capture</Button>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-1 ml-6 space-y-0.5">
          {warnings.map((w, i) => <div key={i} className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/40 rounded px-2 py-1">⚠ {w}</div>)}
        </div>
      )}
    </div>
  );
}

function ContentRow({ c, onChange }: { c: ContentItem; onChange: () => void }) {
  const [saving, setSaving] = useState(false);
  const move = async (to: string) => {
    setSaving(true);
    try {
      await api("PATCH", "/api/coomander/content", { id: c.id, transitionTo: to, reason: "manual" });
      toast.success(`Moved to ${to}`);
      onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-900 dark:text-gray-100">{c.title}</span>
      <select
        className="ml-auto border rounded px-1 py-0.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900"
        value={c.current_state}
        disabled={saving}
        onChange={(e) => move(e.target.value)}
      >
        {CONTENT_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function ProcCol({ title, items }: { title: string; items: Array<Json> }) {
  return (
    <div>
      <div className="font-medium text-gray-700 dark:text-gray-300">{title}</div>
      {items.length === 0 && <p className="text-xs text-gray-400">Nothing urgent.</p>}
      {items.map((it) => (
        <div key={String(it.id)} className="text-gray-800 dark:text-gray-200">
          {String(it.label)} {it.needed_by ? <span className="text-xs text-amber-600">by {String(it.needed_by)}</span> : null}
        </div>
      ))}
    </div>
  );
}

function AddPillar({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("content");
  const add = async () => {
    if (!name.trim()) return;
    try { await api("POST", "/api/coomander/pillars", { name, kind }); setName(""); toast.success("Pillar added"); onAdded(); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card title="Add pillar">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Pillar name" value={name} onChange={(e) => setName(e.target.value)} className="text-gray-900 dark:text-gray-100" />
        <select className="border rounded px-2 py-1 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900" value={kind} onChange={(e) => setKind(e.target.value)}>
          {PILLAR_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <Button onClick={add}>Add</Button>
      </div>
    </Card>
  );
}

function AddBeat({ pillars, onAdded }: { pillars: Array<{ id: string; name: string }>; onAdded: () => void }) {
  const [pillarId, setPillarId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("daily");
  const [target, setTarget] = useState("1");
  const add = async () => {
    if (!pillarId || !name.trim()) { toast.error("Pick a pillar and name"); return; }
    try {
      await api("POST", "/api/coomander/beats", { pillarId, name, cadenceKind: kind, targetCount: Number(target) });
      setName(""); toast.success("Beat added"); onAdded();
    } catch (e) { toast.error((e as Error).message); }
  };
  if (pillars.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
      <select className="border rounded px-2 py-1 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900" value={pillarId} onChange={(e) => setPillarId(e.target.value)}>
        <option value="">Pillar…</option>
        {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Input placeholder="Beat name" value={name} onChange={(e) => setName(e.target.value)} className="text-gray-900 dark:text-gray-100" />
      <select className="border rounded px-2 py-1 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900" value={kind} onChange={(e) => setKind(e.target.value)}>
        {CADENCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <Input value={target} onChange={(e) => setTarget(e.target.value)} className="w-16 text-gray-900 dark:text-gray-100" />
      <Button size="sm" onClick={add}>Add beat</Button>
    </div>
  );
}

function AddContent({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const add = async () => {
    if (!title.trim()) return;
    try { await api("POST", "/api/coomander/content", { title }); setTitle(""); toast.success("Content added"); onAdded(); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="mt-3 flex items-center gap-2 border-t pt-3">
      <Input placeholder="New content title" value={title} onChange={(e) => setTitle(e.target.value)} className="text-gray-900 dark:text-gray-100" />
      <Button size="sm" onClick={add}>Add</Button>
    </div>
  );
}

function AddProcurement({ onAdded }: { onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<string>("shoot_prep");
  const [neededBy, setNeededBy] = useState("");
  const add = async () => {
    if (!label.trim()) return;
    try {
      await api("POST", "/api/coomander/procurement", { label, category, neededBy: neededBy || undefined });
      setLabel(""); setNeededBy(""); toast.success("Item added"); onAdded();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      <Input placeholder="Item label" value={label} onChange={(e) => setLabel(e.target.value)} className="text-gray-900 dark:text-gray-100" />
      <select className="border rounded px-2 py-1 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="shoot_prep">shoot_prep</option>
        <option value="business_admin">business_admin</option>
      </select>
      <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className="text-gray-900 dark:text-gray-100" />
      <Button size="sm" onClick={add}>Add</Button>
    </div>
  );
}
