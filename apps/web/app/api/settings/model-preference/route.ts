import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { errorResponse, UnauthorizedError, BadRequestError } from "@/lib/errors";
import { listUserSelectableModels } from "@/lib/model-catalog";
import {
  getUserModelPreference,
  setUserModelPreference,
  getAdminDefaultModel,
  resolveActiveModelId,
} from "@/lib/active-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/settings/model-preference — the signed-in user's model preference,
 * the user-selectable catalog, and the effective model after precedence.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) throw new UnauthorizedError();

    const [preference, adminDefault, effective] = await Promise.all([
      getUserModelPreference(session.user.id),
      getAdminDefaultModel(),
      resolveActiveModelId({ userId: session.user.id }),
    ]);

    return NextResponse.json({
      preference,
      adminDefaultModel: adminDefault,
      effectiveModel: effective,
      models: listUserSelectableModels(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PUT /api/settings/model-preference — set or clear the user's preference.
 * Body: { modelId: string | null }. null clears (revert to admin default).
 * A non-null id must be a user-selectable catalog model; otherwise 400.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = (await req.json().catch(() => null)) as { modelId?: unknown } | null;
    const modelId = body?.modelId;

    if (modelId !== null && typeof modelId !== "string") {
      throw new BadRequestError("modelId must be a string or null");
    }

    // setUserModelPreference validates against the catalog + user-selectable flag.
    await setUserModelPreference(session.user.id, modelId);

    const effective = await resolveActiveModelId({ userId: session.user.id });
    return NextResponse.json({ ok: true, preference: modelId, effectiveModel: effective });
  } catch (err) {
    return errorResponse(err);
  }
}
