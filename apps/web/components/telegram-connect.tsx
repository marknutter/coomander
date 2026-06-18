"use client";

/**
 * Connect Telegram banner (#185). Shown on the home when the creator's Telegram
 * isn't linked yet: mint a one-time code, surface the t.me deep link + the code,
 * and poll until the webhook binds the chat. Renders nothing once linked.
 */

import { useState, useEffect, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/use-toast";

interface MintedLink {
  code: string;
  deepLink: string;
  botUsername: string;
}

export function TelegramConnect() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [link, setLink] = useState<MintedLink | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/coomander/telegram-link");
      if (r.ok) setLinked(!!(await r.json()).linked);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Poll while a code is showing, until the chat connects.
  useEffect(() => {
    if (!link || linked) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch("/api/coomander/telegram-link");
        if (!r.ok) return;
        if ((await r.json()).linked) {
          setLink(null);
          setLinked(true);
          toast.success("Telegram connected 🎉");
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(t);
  }, [link, linked]);

  async function connect() {
    setBusy(true);
    try {
      const r = await fetch("/api/coomander/telegram-link", { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as MintedLink;
      setLink({ code: d.code, deepLink: d.deepLink, botUsername: d.botUsername });
    } catch (err) {
      console.error("[TelegramConnect]", err);
      toast.error("Couldn't start Telegram linking. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (linked === null || linked) return null; // loading, or already connected → no banner

  return (
    <Card title="Connect Telegram" headerAction={<Send className="w-4 h-4 text-primary" />}>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        Link Telegram so Coomander can nudge you on your phone — and you just reply with what you
        shipped. It&apos;s the same thread you see in chat here.
      </p>
      {link ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <a
            href={link.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Send className="w-4 h-4" />
            Open @{link.botUsername}
          </a>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            or send @{link.botUsername} the code{" "}
            <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono text-gray-900 dark:text-gray-100">{link.code}</code>
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 sm:ml-auto">
            <Loader2 className="w-3 h-3 animate-spin" /> waiting…
          </span>
        </div>
      ) : (
        <Button variant="primary" loading={busy} icon={<Send className="w-4 h-4" />} onClick={connect}>
          Connect Telegram
        </Button>
      )}
    </Card>
  );
}
