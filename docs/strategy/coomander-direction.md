# Coomander direction

**Last updated:** 2026-06-04
**Status:** Active. Canonical reference for ops-layer epics #150–#154 and Ops E/G/H.
**Companion docs:** `communication-policy.md`, `features-brainstorm.md`.

This doc captures the validated direction for Coomander — the AI ops agent inside MaddieHQ. It's the canonical artifact; GitHub issues are implementation contracts pointing at it.

## Scope

**OF-only.** MaddieHQ is focused exclusively on the OF creator workflow: top-of-funnel content on IG, OF subscription, OF wall + PPV monetization, fan chat assistance. Adjacent creator-economy work (TikTok-as-primary, Twitch streaming, brand businesses) is **out of scope** — Coomander does not track, plan around, or know about them.

This was a deliberate narrowing after the creator-research synthesis (June 2026). Real OF creators run parallel ventures, but MaddieHQ wins by going deep on one workflow rather than being a generic creator operating system.

## What Coomander is

A two-way AI agent that contacts the creator on Telegram to keep her on schedule, consistent, and supported across the OF workflow. Reads the live ops state from the domain model, decides whether to ping, generates a message in its persona, and accepts inbound replies that classify into structured domain actions (log a drop, mark a blocker, add a procurement item, etc.).

**Architecturally** built on the geology agent pattern (`~/Code/geology/web/node/lib/geology/`): cron-driven outbound, Telegram inbound webhook with Anthropic tool-use classification, dedup, per-user state, token usage tracking.

## Persona: light companion now, full companion later

Coomander is **direct, slightly tongue-in-cheek, NOT corporate** — modeled on the actual management style the creator-research surfaced.

Praise is **data-grounded only**. Never generic. When a reel hits the creator's top-decile saves, Coomander says so specifically. When it doesn't, Coomander doesn't pretend.

**Light companion (v1):** warm tone, contextual praise grounded in real data, doesn't pretend to remember things it doesn't know.

**Full companion (later):** persistent memory of creator's life (kid's name, partner, hobbies, mood patterns, milestones), brings them up unprompted, banters about non-work stuff when natural. **Critical preparation for this lands in v1:** all Coomander↔creator chat logs are persisted indefinitely from day one with no TTL, schema-shaped for future memory mining. The substrate must exist before the companion layer can be turned on.

## Nag frequency

Default to **tight** (closer to the real manager's during-shoot cadence) — multiple meaningful touchpoints per day when content is in flight, daily anchor pings otherwise. **Per-user adjustable** via settings: a creator who finds it overbearing can dial it back. The default leans toward more nag because the research signal is that this is what actually keeps creators on task.

## Communication boundaries

See `communication-policy.md` for the full posture. Summary:

- **In scope:** Coomander↔creator on Telegram. Creator↔fan chat assistance on OF, Telegram, WhatsApp (path: AI assists humans, humans send).
- **Out of scope:** IG/TikTok/FB DM automation. AI auto-publishing of content. Sending messages to anyone other than the verified creator without explicit approval.
- **Re-litigation requires explicit decision** and update to the policy doc.

## Cadence model

### Day 1–6 ramp (validated from creator research)

```
Day 1: 1 reel
Day 2: 2 reels
Day 3: 3 reels
Day 4: 3 reels + 1 trial
Day 5: 3 reels + 2 trials
Day 6: 3 reels + 3 trials
Day 7+: 3 reels + 3 trials (continuing)
```

### OF wall content: daily-vlog, not periodic batches

The creator-research surfaced a sharper framing than the original spec: wall content works best when treated as **passive daily vlogging** — phone glued to hand, capture 5–10 short pieces per outfit/room change throughout the day. Once a buffer is built (typically within a week), the creator can shift effort to customs and themed batches.

Coomander surfaces wall content as a daily-cadence beat with a **buffer goal** (e.g., "stay 3+ days ahead on wall posts"), not a window-kind batch every 2–3 days.

### Trials vs normal reels

**Trials are IG-only.** TikTok and FB don't have an equivalent mechanic. The domain model needs to know that some beat subtypes only apply to specific platforms.

### Content cushion as headline metric

The agency's leading indicator is **content-cushion days** — "how many days of approved-and-ready content do we have." Coomander surfaces this as the headline operational metric on the weekly review, not raw post counts.

## Fan chat assistance (Ops H, new direction June 2026)

The original ToS posture (no auto-comms) covered IG/TikTok/FB DM automation — high ban risk. **OF-side and Telegram/WhatsApp-side messaging are different**: those platforms permit creator-to-fan messaging, and chatting is the highest-time-cost activity in real OF workflows.

The chosen path is **(b) AI assist for human chatters**: we generate suggested responses, sexting scripts, fan-segment messages — the human chatting team sends them. Same voice-corpus tech we already specced in #149, lower stakes because a human gatekeeps every outbound message. Later (post-v1) we can layer in (a) full AI chat on Telegram/WhatsApp where it's clean, once voice fidelity has been proven.

**Skip (c)** (partner service integration) unless a partner falls into our lap.

## Anti-features (do not build)

From creator research synthesis:

- **No auto-publishing.** Coomander reminds, never executes.
- **No fake banter.** If the companion layer doesn't know a personal detail, it doesn't fabricate.
- **No fan-specific generation Coomander can't ground.** Don't pretend to know what the chatting team or fan history actually contains.
- **No metric-dump dashboards.** Celebrate milestones; don't fire daily KPI summaries that get ignored.
- **No IG/TikTok/FB DM automation.** Per the communication policy.

## How this maps to the issue set

| Layer | Epic | What it owns |
|---|---|---|
| Coordination | **#150** | OF-only ops layer umbrella |
| Infra | **#151** | Cron + Telegram + Anthropic + dedup + chat-log retention |
| Domain | **#152** | Pillars, beats, drops, procurement, content states, platform-specific subtypes |
| Defaults | **#153** | Day 1–6 ramp, OF prohibitions, daily-vlog wall, companion-warm persona |
| Ritual | **#154** | Weekly review with drift questions + content-cushion days |
| Per-shot review | **Ops E** | Drop a clip, get a quick rules-based read |
| Hot requests | **Ops G** | Priority-interrupt queue for VIP / brand / casting requests |
| Fan-chat assist | **Ops H** | Path (b) — generate scripts and response drafts for human chatters |

## What changed from earlier drafts (June 2026 redirection)

For history. Earlier drafts of this direction included:

1. **Parallel-project awareness** — dropped. OF-only.
2. **Comment-to-DM on IG with voice mirror** — confirmed dropped. IG account-ban risk too high.
3. **Strict no-fan-comms ToS filter** — relaxed *only* for OF/Telegram/WhatsApp where it's permitted. IG/TikTok/FB stay off.
4. **Strict-operational persona** — replaced with light-companion (warm-but-grounded) + future-full-companion via persistent chat log.
5. **Daily-cadence nag default** — tightened. Default leans toward more frequent touchpoints, user-adjustable.
6. **OF wall as window-kind beat** — replaced with daily-vlog cadence + buffer goal.

If the direction changes again, update this doc *first*, then propagate to the issues.
