"use client";

import { useEffect, useState, useCallback } from "react";
import { Tabs, TabPanel, Card } from "@/components/ui";
import { MetricCard, DataTable, PercentageBar } from "@/components/admin/analytics-charts";
import { Loader2, RefreshCw } from "lucide-react";

// ——— Types ———

interface GrowthData {
  signupsByDay: { day: string; count: number }[];
  dau: number;
  wau: number;
  mau: number;
  conversionRate: number;
  totalUsers: number;
  proUsers: number;
}

interface RevenueData {
  mrr: number;
  proPrice: number;
  planBreakdown: { free: number; pro: number };
  recentUpgrades: { id: string; email: string; upgraded_at: string; source: string }[];
}

interface ProductData {
  avgItemsPerUser: number;
  usersWithItems: number;
  totalItems: number;
  totalUsers: number;
  topCategories: { category: string; count: number }[];
}

type TabKey = "growth" | "revenue" | "product";

const TABS: { key: TabKey; label: string }[] = [
  { key: "growth", label: "Growth" },
  { key: "revenue", label: "Revenue" },
  { key: "product", label: "Product" },
];

// ——— Fetch helpers ———

async function fetchGrowth(): Promise<GrowthData> {
  const res = await fetch("/api/admin/analytics/growth");
  if (!res.ok) throw new Error("Failed to fetch growth data");
  const json = await res.json();
  return json.data;
}

async function fetchRevenue(): Promise<RevenueData> {
  const res = await fetch("/api/admin/analytics/revenue");
  if (!res.ok) throw new Error("Failed to fetch revenue data");
  const json = await res.json();
  return json.data;
}

async function fetchProduct(): Promise<ProductData> {
  const res = await fetch("/api/admin/analytics/product");
  if (!res.ok) throw new Error("Failed to fetch product data");
  const json = await res.json();
  return json.data;
}

// ——— Tab Panels ———

function GrowthPanel({ data }: { data: GrowthData }) {
  const recentSignups = data.signupsByDay.slice(-7).reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard label="Total Users" value={data.totalUsers.toLocaleString()} />
        <MetricCard label="DAU" value={data.dau.toLocaleString()} sub="Active today" />
        <MetricCard label="WAU" value={data.wau.toLocaleString()} sub="Active last 7 days" />
        <MetricCard label="MAU" value={data.mau.toLocaleString()} sub="Active last 30 days" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          label="Conversion Rate"
          value={`${(data.conversionRate * 100).toFixed(1)}%`}
          sub={`${data.proUsers} pro of ${data.totalUsers} total`}
        />
        <MetricCard
          label="Signups (last 7 days)"
          value={recentSignups.toLocaleString()}
          sub="New users"
        />
      </div>

      <Card title="Signups — Last 30 Days">
        <DataTable
          columns={[
            { key: "day", label: "Date" },
            { key: "count", label: "Signups", align: "right" },
          ]}
          rows={[...data.signupsByDay].reverse() as Record<string, unknown>[]}
          emptyMessage="No signups in the last 30 days"
        />
      </Card>
    </div>
  );
}

function RevenuePanel({ data }: { data: RevenueData }) {
  const total = data.planBreakdown.free + data.planBreakdown.pro;
  const proRatio = total > 0 ? data.planBreakdown.pro / total : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricCard label="MRR" value={`$${data.mrr.toFixed(2)}`} sub={`${data.planBreakdown.pro} pro users`} />
        <MetricCard label="Pro Users" value={data.planBreakdown.pro.toLocaleString()} />
        <MetricCard label="Free Users" value={data.planBreakdown.free.toLocaleString()} />
      </div>

      <Card title="Plan Breakdown">
        <div className="space-y-3 py-1">
          <PercentageBar
            label="Pro"
            value={proRatio}
            colorClass="bg-primary"
          />
          <PercentageBar
            label="Free"
            value={total > 0 ? data.planBreakdown.free / total : 0}
            colorClass="bg-zinc-400"
          />
        </div>
      </Card>

      <Card title="Recent Upgrades (last 30 days)">
        <DataTable
          columns={[
            { key: "email", label: "User" },
            { key: "upgraded_at", label: "Upgraded At" },
            { key: "source", label: "Source" },
          ]}
          rows={data.recentUpgrades as unknown as Record<string, unknown>[]}
          emptyMessage="No upgrades in the last 30 days"
        />
      </Card>
    </div>
  );
}

function ProductPanel({ data }: { data: ProductData }) {
  const topCategoryMax = data.topCategories[0]?.count ?? 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Avg Items / User"
          value={data.avgItemsPerUser.toFixed(1)}
          sub={`${data.usersWithItems} users with items`}
        />
        <MetricCard label="Total Items" value={data.totalItems.toLocaleString()} />
        <MetricCard label="Total Users" value={data.totalUsers.toLocaleString()} />
      </div>

      {data.topCategories.length > 0 && (
        <Card title="Top 10 Categories">
          <div className="space-y-2 py-1">
            {data.topCategories.map((cat) => (
              <PercentageBar
                key={cat.category}
                label={cat.category}
                value={cat.count / topCategoryMax}
                colorClass="bg-primary"
                showPercent={false}
                className="gap-2"
              />
            ))}
          </div>
          <DataTable
            columns={[
              { key: "category", label: "Category" },
              { key: "count", label: "Items", align: "right" },
            ]}
            rows={data.topCategories as Record<string, unknown>[]}
            className="mt-4"
          />
        </Card>
      )}
    </div>
  );
}

// ——— Main Page ———

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("growth");

  const [growthData, setGrowthData] = useState<GrowthData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [productData, setProductData] = useState<ProductData | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTab = useCallback(async (tab: TabKey, force = false) => {
    // Skip fetch if data already cached and not a forced refresh
    const alreadyCached =
      (tab === "growth" && growthData !== null) ||
      (tab === "revenue" && revenueData !== null) ||
      (tab === "product" && productData !== null);
    if (alreadyCached && !force) return;

    setLoading(true);
    setError(null);
    try {
      if (tab === "growth") setGrowthData(await fetchGrowth());
      else if (tab === "revenue") setRevenueData(await fetchRevenue());
      else if (tab === "product") setProductData(await fetchProduct());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [growthData, revenueData, productData]);

  async function refresh() {
    // Only reset and re-fetch the active tab
    if (activeTab === "growth") setGrowthData(null);
    else if (activeTab === "revenue") setRevenueData(null);
    else if (activeTab === "product") setProductData(null);
    await loadTab(activeTab, true);
  }

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab, loadTab]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Analytics</h1>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={(k) => setActiveTab(k as TabKey)} className="mb-6" />

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <TabPanel active={activeTab === "growth"}>
            {growthData ? <GrowthPanel data={growthData} /> : null}
          </TabPanel>
          <TabPanel active={activeTab === "revenue"}>
            {revenueData ? <RevenuePanel data={revenueData} /> : null}
          </TabPanel>
          <TabPanel active={activeTab === "product"}>
            {productData ? <ProductPanel data={productData} /> : null}
          </TabPanel>
        </>
      )}
    </div>
  );
}
