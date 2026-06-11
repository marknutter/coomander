# Communication policy

**Last updated:** 2026-06-04
**Status:** Active. Governs all features that send messages on behalf of a creator.

This doc draws the line between communication features Coomander will and won't ship. The line is platform-by-platform because the ToS and ban-risk profiles differ sharply.

## Core principle

**Ban risk on the IG account is existential** because IG is the top-of-funnel for OF subscriptions. Lose the IG account, lose the funnel, lose the revenue. So Coomander will *not* automate communication on platforms where automation triggers bans, even when competitors do.

Where automation is permitted by the platform — OF, Telegram, WhatsApp — Coomander will build communication features deliberately, with human gatekeepers where appropriate.

## Decision matrix

| Channel | Direction | Coomander posture |
|---|---|---|
| Coomander → creator (Telegram) | Outbound | **In scope.** Creator-consented, no third-party visibility. |
| Creator → Coomander (Telegram) | Inbound | **In scope.** Webhook + tool-use classifier. |
| Creator → fan on **OF** | Outbound | **In scope, human-sent (path b).** AI generates scripts and response drafts; chatting team sends. Later, AI-direct may land here if voice fidelity proves out. |
| Creator → fan on **Telegram / WhatsApp** | Outbound | **In scope, human-sent (path b).** Same posture as OF. AI-direct possible later. |
| Creator → fan on **Instagram DM** | Outbound | **Out of scope.** Includes comment-to-DM, story-reply-to-DM, "warm leads" routing. Ban risk too high; the IG account is the funnel. |
| Creator → fan on **TikTok DM** | Outbound | **Out of scope.** Same reasoning as IG. |
| Creator → fan on **Facebook DM** | Outbound | **Out of scope.** Same reasoning. |
| Creator → fan on **Snapchat DM** | Outbound | **Out of scope.** Same reasoning. |
| Coomander → anyone other than the verified creator | Outbound | **Out of scope.** No exceptions in v1. |

## Path (b) explained

For OF / Telegram / WhatsApp fan messaging, the architecture is:

1. **Coomander generates** suggested response, sexting script segment, or mass-DM template, grounded in the creator's voice corpus (#149) and any fan context the creator has supplied.
2. **The output is staged** for review — either in the Coomander web UI or piped to the chatting team's existing tooling.
3. **A human sends it.** No automated send. No background job that fires copy to a real fan without a human key press.

This stays on the right side of platform terms and the right side of brand-safety. It also matches the actual workflow the creator-research surfaced: the agency's chatting team is real humans using scripts and intelligence the manager provides. We're slotting in as the intelligence supplier, not displacing the human.

## What "out of scope" actually means

Out-of-scope channels don't get features built. They also don't get *gestural* features. Examples of things we will NOT do for IG DMs even though they look small:

- "Suggested DM reply" buttons that populate IG composer via a deep link
- "Top intent comments" lists with a "DM this person" CTA
- Trigger workflows like "follower X did Y, ping suggesting Z"
- "Voice-cloned welcome DM" templates rendered for the creator to copy-paste

If we ever change posture on IG, this doc gets updated *first*, and the change requires explicit decision by the project owner (not a coding-agent inference).

## Adjacent rule: AI content tagging

For any content Coomander generates that ends up published on OF (scripts, captions, image assistance), the **OF 2026 AI disclosure rules apply**:
- Content "depicting the creator" produced with AI assistance must be tagged `#AI` / `#AIGenerated` per OF policy.
- Deepfakes of any real person other than the verified creator are immediate-ban — Coomander does not generate face-swapped imagery of the creator or anyone else.
- Voice cloning is limited to the creator's own voice with their explicit consent (matches ElevenLabs Professional Voice Clone requirements).

This is enforced in code at the generation layer, not left to creator discretion.

## How this is enforced

- **Code-level**: there is no IG-DM-send function. There is no TikTok-DM-send function. The OF / Telegram / WhatsApp message generation surfaces stage drafts to a human reviewer, never to an outbound queue.
- **Doc-level**: this file. Every new communication feature must point at this doc and declare which row of the matrix it sits on.
- **Issue-level**: epics that touch communication must reference this doc and the relevant row.

## Re-litigating the line

Things that would justify revisiting:

1. A specific platform changes its policy in a way that makes automation explicitly safe.
2. Empirical evidence from a partner agency that a specific automation pattern has ≥6 months of clean operation across ≥20 creators.
3. The creator demands it loudly enough that the alternative is them leaving the product.

In each case: update this doc with the rationale, then update the affected epics. Do not work around this doc.
