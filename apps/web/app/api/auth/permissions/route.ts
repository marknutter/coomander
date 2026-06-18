export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPermissions } from "@/lib/rbac";
import { errorResponse, UnauthorizedError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) throw new UnauthorizedError();

    const permissions = await getUserPermissions(session.user.id);

    return NextResponse.json({ permissions });
  } catch (error) {
    return errorResponse(error);
  }
}
