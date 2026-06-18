import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { user } from "@/lib/schema";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { image } = await request.json();
    if (!image || typeof image !== "string") throw new BadRequestError("Image URL is required");

    await getDb()
      .update(user)
      .set({ image })
      .where(eq(user.id, session.user.id));

    return NextResponse.json({ ok: true, image });
  } catch (error) {
    return errorResponse(error);
  }
}
