import { devDocsSource } from "@/lib/dev-docs-source";
import { createFromSource } from "fumadocs-core/search/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const search = createFromSource(devDocsSource);

export async function GET(request: NextRequest) {
  // Protect wiki search behind admin auth
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return search.GET(request);
}
