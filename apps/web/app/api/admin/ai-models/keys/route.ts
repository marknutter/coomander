import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { errorResponse, BadRequestError } from "@/lib/errors";
import {
  setProviderKey,
  clearProviderKey,
  getProviderKeyStatus,
  isKeyProvider,
} from "@/lib/provider-keys";
import { logAdminAction } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT /api/admin/ai-models/keys — set/replace a provider API key.
 * Body: { provider: "anthropic"|"openai"|"google", key: string }.
 *
 * The plaintext key is encrypted at rest and NEVER returned to the client or
 * logged. Responds with the masked configured/not status only. Admin-gated.
 */
export async function PUT(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_SETTINGS);
  if (error) return error;

  try {
    const body = (await req.json().catch(() => null)) as
      | { provider?: unknown; key?: unknown }
      | null;
    const provider = body?.provider;
    const key = body?.key;

    if (typeof provider !== "string" || !isKeyProvider(provider)) {
      throw new BadRequestError("Unknown provider");
    }
    if (typeof key !== "string" || !key.trim()) {
      throw new BadRequestError("key is required");
    }

    await setProviderKey(provider, key, session.user.id);

    // Best-effort audit — records WHO set WHICH provider key, never the value.
    await logAdminAction(
      session.user.id,
      "admin.provider_key_set",
      "provider_key",
      provider,
    ).catch(() => {});

    const status = await getProviderKeyStatus(provider);
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/admin/ai-models/keys?provider=... — remove a provider's DB key
 * (resolution then falls back to the ENV var). Admin-gated.
 */
export async function DELETE(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_SETTINGS);
  if (error) return error;

  try {
    const provider = req.nextUrl.searchParams.get("provider") ?? "";
    if (!isKeyProvider(provider)) {
      throw new BadRequestError("Unknown provider");
    }

    await clearProviderKey(provider);

    await logAdminAction(
      session.user.id,
      "admin.provider_key_clear",
      "provider_key",
      provider,
    ).catch(() => {});

    const status = await getProviderKeyStatus(provider);
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return errorResponse(err);
  }
}
