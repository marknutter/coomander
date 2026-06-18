import { Card } from "@/components/ui";

export default function AdminDashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-6">Dashboard</h1>
      <Card title="Welcome to Admin">
        <p className="text-zinc-600 dark:text-zinc-400">
          Use the sidebar to navigate between admin tools. This dashboard will be replaced with metrics and activity feeds.
        </p>
      </Card>
    </div>
  );
}
