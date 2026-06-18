import { docsSource } from "@/lib/docs-source";
import { createFromSource } from "fumadocs-core/search/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const { GET } = createFromSource(docsSource);
