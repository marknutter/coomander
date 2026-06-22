/**
 * GET|PATCH /api/coomander/settings — the session user's Coomander settings (#151).
 *
 * GET returns the resolved settings (defaults applied when no row exists).
 * PATCH updates the nag preset and/or persona mode. Per-user overrides persist
 * in `coomander_settings` (DB, not env), so they survive deploys.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getCoomanderSettings,
  updateCoomanderSettings,
  isValidNagFrequency,
  isValidPersonaMode,
  type SettingsPatch,
} from "@/lib/coomander/settings";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** True if `tz` is a valid IANA timezone (Intl throws on unknown zones). */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    const settings = await getCoomanderSettings(session.user.id);
    return NextResponse.json({ settings });
  } catch (error) {
    log.error("GET /api/coomander/settings failed", { error });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: SettingsPatch = {};

    if (body.nagFrequency !== undefined) {
      if (!isValidNagFrequency(body.nagFrequency)) {
        throw new BadRequestError("nagFrequency must be one of: off, light, moderate, tight");
      }
      patch.nagFrequency = body.nagFrequency;
    }
    if (body.personaMode !== undefined) {
      if (!isValidPersonaMode(body.personaMode)) {
        throw new BadRequestError("personaMode must be one of: light_companion, full_companion, operational");
      }
      patch.personaMode = body.personaMode;
    }
    if (body.pingTimesJson !== undefined) {
      if (body.pingTimesJson !== null && typeof body.pingTimesJson !== "string") {
        throw new BadRequestError("pingTimesJson must be a string or null");
      }
      patch.pingTimesJson = body.pingTimesJson as string | null;
    }
    if (body.timezone !== undefined) {
      if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
        throw new BadRequestError("timezone must be a valid IANA timezone, e.g. America/Chicago");
      }
      patch.timezone = body.timezone;
    }
    // Stamps defaults_banner_dismissed_at — used by onboarding (#173) as the
    // "creator confirmed their starter cadence defaults" signal.
    if (body.dismissBanner === true) {
      patch.dismissBanner = true;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestError("no valid fields to update");
    }

    const settings = await updateCoomanderSettings(session.user.id, patch);
    return NextResponse.json({ settings });
  } catch (error) {
    log.error("PATCH /api/coomander/settings failed", { error });
    return errorResponse(error);
  }
}
