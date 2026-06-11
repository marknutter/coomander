/**
 * Outbound Telegram send for Coomander (#151, milestone 1).
 *
 * Ported from ~/Code/geology/web/node/lib/geology/telegram.ts, adapted for
 * Coomander's multi-tenant model: the caller passes the destination `chatId`
 * (resolved from each user's `telegramChatId` row), and the bot token is the
 * Coomander-dedicated `MADDIE_TELEGRAM_BOT_TOKEN`.
 *
 * Posts directly to the Bot API so it works from a Cloudflare Worker or Node
 * route with no MCP dependency. Never throws: returns a status object so the
 * cron route can log a failure and still respond 200.
 *
 * IMPORTANT — difference from geology: geology suppresses all outbound Telegram
 * whenever NODE_ENV != production, to avoid the dev server posting into the prod
 * bot thread (it shares one bot across environments). Coomander uses a DEDICATED
 * bot (@coomander_bot), so there is no shared-thread hazard, and milestone 1's
 * whole point is to verify an end-to-end send from the DEV environment. So this
 * does NOT suppress in dev. `COOMANDER_TELEGRAM_DISABLED` is an explicit opt-out
 * only (1/true to force off); it is NOT keyed off NODE_ENV. Per the deploy
 * gotcha, never set a forcing value in `.env.local` — it would bake into the
 * prod bundle.
 */

export interface TelegramSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

/** Parse an explicit on/off override. null = not set. */
function flagSet(v: string | undefined): boolean | null {
  if (v == null || v === "") return null;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

/**
 * Whether outbound Telegram is suppressed. Default: ENABLED everywhere (incl.
 * dev), because the bot is Coomander-dedicated. Only an explicit
 * COOMANDER_TELEGRAM_DISABLED=1 turns it off.
 */
function telegramDisabled(): boolean {
  return flagSet(process.env.COOMANDER_TELEGRAM_DISABLED) === true;
}

export async function sendTelegram(chatId: string, text: string): Promise<TelegramSendResult> {
  if (telegramDisabled()) {
    console.log(`[coomander/telegram] disabled via COOMANDER_TELEGRAM_DISABLED; skipped send to ${chatId}: ${text.slice(0, 80)}`);
    return { ok: false, error: "telegram disabled via COOMANDER_TELEGRAM_DISABLED" };
  }

  const token = process.env.MADDIE_TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "MADDIE_TELEGRAM_BOT_TOKEN not set" };
  if (!chatId) return { ok: false, error: "no chatId" };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description || `telegram http ${res.status}` };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
