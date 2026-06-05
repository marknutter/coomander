"use client";

/**
 * "Meet Coomander" — conversational first-run onboarding (#173, epic #168).
 *
 * Replaces the generic template Onboarding tour. Coomander walks a new creator
 * through setup in its own voice: enable ops (seed the v1 playbook) → confirm
 * the starter cadence → connect Instagram → (optionally) Telegram. Each step
 * wires the real action (enable / settings / IG-OAuth surfaces).
 *
 * Progress is DERIVED server-side (GET /api/coomander/onboarding), so the flow
 * is resumable across sessions/browsers — it opens on the first step the creator
 * hasn't actually completed. It's skippable; the skip is remembered per browser
 * so it doesn't nag, but real progress always comes from the server signals.
 */

import { useState, useEffect, useCallback } from "react";
import { Bot, Sparkles, Instagram, Send, Check, X, ArrowRight, ListChecks, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/use-toast";

export const ONBOARDING_DISMISSED_KEY = "coomander-onboarding-dismissed";

type StepKey = "ops" | "cadence" | "instagram" | "telegram";

interface OnboardingStatus {
  steps: Record<StepKey, boolean>;
  complete: boolean;
}

// Order per #173: enable ops → connect Instagram → confirm cadence → link Telegram.
const ORDER: StepKey[] = ["ops", "instagram", "cadence", "telegram"];

export interface CoomanderOnboardingProps {
  open: boolean;
  onClose: () => void;
  /** Fired when the creator finishes (so the home can refresh its brief). */
  onComplete?: () => void;
}

export function CoomanderOnboarding({ open, onClose, onComplete }: CoomanderOnboardingProps) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [step, setStep] = useState<StepKey>("ops");
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/coomander/onboarding");
    if (!res.ok) throw new Error(`onboarding status failed: ${res.status}`);
    const data = (await res.json()) as OnboardingStatus;
    setStatus(data);
    // Resume on the first incomplete step (required first, then optional).
    const firstIncomplete = ORDER.find((k) => !data.steps[k]) ?? "telegram";
    setStep(firstIncomplete);
    return data;
  }, []);

  useEffect(() => {
    if (!open) return;
    loadStatus().catch((err) => {
      console.error("[Coomander onboarding]", err);
    });
  }, [open, loadStatus]);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true"); } catch {}
    onClose();
  }, [onClose]);

  const finish = useCallback(() => {
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true"); } catch {}
    onComplete?.();
    onClose();
  }, [onClose, onComplete]);

  const goNext = useCallback(() => {
    const idx = ORDER.indexOf(step);
    if (idx >= ORDER.length - 1) { finish(); return; }
    setStep(ORDER[idx + 1]);
  }, [step, finish]);

  async function enableOps() {
    setBusy(true);
    try {
      const res = await fetch("/api/coomander/enable", { method: "POST" });
      if (!res.ok) throw new Error(`enable failed: ${res.status}`);
      await loadStatus();
      setStep("instagram");
      toast.success("Coomander is on — starter playbook seeded.");
    } catch (err) {
      console.error("[Coomander onboarding] enable", err);
      toast.error("Couldn't enable Coomander. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCadence() {
    setBusy(true);
    try {
      const res = await fetch("/api/coomander/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissBanner: true }),
      });
      if (!res.ok) throw new Error(`confirm cadence failed: ${res.status}`);
      await loadStatus();
      setStep("telegram");
    } catch (err) {
      console.error("[Coomander onboarding] cadence", err);
      toast.error("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const stepIndex = ORDER.indexOf(step);
  const done = status?.steps;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6 animate-scale-in">
        {/* Header: avatar + progress + skip */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-9 h-9 bg-accent rounded-xl">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="flex items-center gap-1.5">
              {ORDER.map((k, i) => (
                <div
                  key={k}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === stepIndex ? "w-6 bg-primary" : done?.[k] ? "w-3 bg-primary" : "w-3 bg-gray-200 dark:bg-gray-600"
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Skip onboarding"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conversational step body */}
        {!status ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : (
          <div className="mb-6">
            {step === "ops" && (
              <StepBody
                icon={<Sparkles className="w-5 h-5 text-primary" />}
                title="Hey — I'm Coomander."
                body="I'm your operations manager. I keep your content cadence on track, log what you ship when you just tell me in plain language, and flag blockers before they bite. First, let me set up your starter playbook."
              >
                <Button variant="primary" size="lg" loading={busy} icon={<Sparkles className="w-4 h-4" />} onClick={enableOps} className="w-full">
                  Enable Coomander
                </Button>
              </StepBody>
            )}

            {step === "cadence" && (
              <StepBody
                icon={<ListChecks className="w-5 h-5 text-primary" />}
                title="Your starter cadence is ready."
                body="I've seeded a research-backed cadence — reels, wall content, lives, and PPV — with a gentle Day 1-6 ramp so you're not slammed on day one. You can fine-tune pillars and beats anytime in Cadence."
              >
                <div className="flex flex-col gap-2">
                  <Button variant="primary" size="lg" loading={busy} icon={<Check className="w-4 h-4" />} onClick={confirmCadence} className="w-full">
                    Looks good
                  </Button>
                  <Link href="/app/cadence" className="text-center text-sm text-primary hover:text-primary/80 underline">
                    Adjust in Cadence first
                  </Link>
                </div>
              </StepBody>
            )}

            {step === "instagram" && (
              <StepBody
                icon={<Instagram className="w-5 h-5 text-primary" />}
                title="Connect Instagram (recommended)."
                body="Hook up Instagram and I can ground my nudges in your real numbers — reach, saves, follower trend — instead of guessing. You can skip this and do it later from Insights."
              >
                <div className="flex flex-col gap-2">
                  {done?.instagram ? (
                    <Button variant="primary" size="lg" icon={<ArrowRight className="w-4 h-4" />} onClick={goNext} className="w-full">
                      Instagram connected — continue
                    </Button>
                  ) : (
                    <>
                      <a
                        href="/api/platforms/instagram/oauth/start"
                        className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
                      >
                        <Instagram className="w-4 h-4" />
                        Connect Instagram
                      </a>
                      <button onClick={goNext} className="text-center text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400">
                        Skip for now
                      </button>
                    </>
                  )}
                </div>
              </StepBody>
            )}

            {step === "telegram" && (
              <StepBody
                icon={<Send className="w-5 h-5 text-primary" />}
                title="Want nudges on Telegram?"
                body={
                  done?.telegram
                    ? "Telegram is linked — we're already one continuous thread across web and phone. You're all set."
                    : "I can ping you on Telegram so you stay on track away from your desk — and it's the same thread you see here. You can link it anytime; for now, let's get you to your home."
                }
              >
                <Button variant="primary" size="lg" icon={<Check className="w-4 h-4" />} onClick={finish} className="w-full">
                  {done?.telegram ? "Finish" : "Take me to my home"}
                </Button>
              </StepBody>
            )}
          </div>
        )}

        {/* Skip link (hidden on the final step) */}
        {step !== "telegram" && (
          <button
            onClick={dismiss}
            className="w-full text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
          >
            Skip setup
          </button>
        )}
      </div>
    </div>
  );
}

function StepBody({
  icon, title, body, children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex gap-3 mb-5">
        <div className="flex items-center justify-center w-8 h-8 bg-accent rounded-lg shrink-0">{icon}</div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-1">{title}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{body}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
