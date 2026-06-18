import { loader } from "fumadocs-core/source";
import { devDocs } from "@/.source/server";

export const devDocsSource = loader({
  baseUrl: "/admin/docs",
  source: devDocs.toFumadocsSource(),
});
