import { devDocsSource } from "@/lib/dev-docs-source";
import { WikiPage } from "@/components/admin/wiki-page";
import { getBacklinks } from "@/lib/wiki-backlinks";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import type { MDXContent } from "mdx/types";
import type { TableOfContents } from "fumadocs-core/toc";

interface DocData {
  body: MDXContent;
  toc: TableOfContents;
  title?: string;
  description?: string;
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = devDocsSource.getPage(params.slug);
  if (!page) notFound();

  const { body: MDX, toc, title, description } = page.data as unknown as DocData;
  const slug = params.slug?.join("/") || "index";
  const backlinks = await getBacklinks(slug);

  return (
    <WikiPage
      title={title ?? "Untitled"}
      description={description}
      toc={toc}
      backlinks={backlinks}
    >
      <MDX components={defaultMdxComponents} />
    </WikiPage>
  );
}

export function generateStaticParams() {
  return devDocsSource.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = devDocsSource.getPage(params.slug);
  if (!page) return {};
  return {
    title: `${page.data.title} | Dev Wiki`,
    description: page.data.description,
  };
}
