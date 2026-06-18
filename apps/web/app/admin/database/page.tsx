import Link from "next/link";
import { Card } from "@/components/ui";
import { CuratedViews } from "@/components/admin/curated-views";
import { Database, ExternalLink } from "lucide-react";

export const metadata = {
  title: "Database Browser | Admin",
};

export default function AdminDatabasePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Database Browser</h1>
      </div>

      <Card title="Curated Views" icon={<Database className="h-4 w-4 text-zinc-500" />}>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          Quick access to commonly inspected tables with useful defaults.
        </p>
        <CuratedViews />
      </Card>

      <Card
        title="Generic Table Browser"
        icon={<Database className="h-4 w-4 text-zinc-500" />}
        headerAction={
          <Link
            href="/admin/database/raw"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Open browser
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Browse any table in the database. Supports auto-discovery of columns, pagination,
          sorting, filtering, inline cell editing, and row deletion.
        </p>
      </Card>
    </div>
  );
}
