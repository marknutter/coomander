import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { errorResponse, BadRequestError } from "@/lib/errors";
import { listModels, DEFAULT_MODEL_ID } from "@/lib/model-catalog";
import {
  getAdminDefaultModel,
  setAdminDefaultModel,
  resolveActiveModelId,
  ADMIN_DEFAULT_MODEL_KEY,
} from "@/lib/active-model";
import { getAllProviderKeyStatuses } from "@/lib/provider-keys";
import { isEncryptionConfigured } from "@/lib/secrets-crypto";
import { logAdminAction } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/ai-models — the tiered catalog, the current admin default
 * model, the effective resolved model, and provider-key configured/not status.
 * Never returns any plaintext key. Admin-gated (ADMIN_SETTINGS).
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_SETTINGS);
  if (error) return error;

  try {
    const [adminDefault, effective, providerKeys] = await Promise.all([
      getAdminDefaultModel(),
      resolveActiveModelId(),
      getAllProviderKeyStatuses(),
    ]);

    return NextResponse.json({
      catalog: listModels(),
      adminDefaultModel: adminDefault,
      effectiveModel: effective,
      builtInDefault: DEFAULT_MODEL_ID,
      providerKeys,
      encryptionConfigured: isEncryptionConfigured(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PUT /api/admin/ai-models — set the active default model.
 * Body: { modelId: string }. Validated against the catalog; unknown ids 400.
 */
export async function PUT(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_SETTINGS);
  if (error) return error;

  try {
    const body = (await req.json().catch(() => null)) as { modelId?: unknown } | null;
    const modelId = body?.modelId;
    if (typeof modelId !== "string" || !modelId.trim()) {
      throw new BadRequestError("modelId is required");
    }

    // setAdminDefaultModel validates against the catalog and throws on unknown ids.
    await setAdminDefaultModel(modelId, session.user.id);

    // Best-effort audit (Coomander has no audit infra — record WHO changed the
    // default via the admin action log; never throws into the response path).
    await logAdminAction(
      session.user.id,
      "admin.ai_default_model_change",
      "setting",
      ADMIN_DEFAULT_MODEL_KEY,
      { modelId },
    ).catch(() => {});

    return NextResponse.json({ ok: true, adminDefaultModel: modelId });
  } catch (err) {
    return errorResponse(err);
  }
}
