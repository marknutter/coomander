"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/use-toast";

type AccountState = {
  connected: boolean;
  username: string | null;
  accountId: string | null;
  snapshot: {
    media_count: number | null;
    follower_count: number | null;
    reach: number | null;
    impressions: number | null;
    profile_views: number | null;
    snapshot_date: string;
  } | null;
};

type Post = {
  id: number;
  platform_post_id: string;
  caption: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
  published_at: string | null;
};

type InsightRow = {
  postId: number;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  impressions: number | null;
  saves: number | null;
  shares: number | null;
  engagement: number | null;
};

type Demographics = {
  snapshotDate: string | null;
  ageGender: Array<{ key: string; value: number }>;
  countries: Array<{ key: string; value: number }>;
  cities: Array<{ key: string; value: number }>;
};

type Pattern = {
  title: string;
  description: string;
  evidence: string;
  impact: string;
};

type Recommendation = {
  action: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
};

type ContentReport = {
  patterns: Pattern[];
  recommendations: Recommendation[];
  summary: string;
  postsAnalyzed: number;
  generatedAt: string;
};

type StreamEvent = {
  phase: string;
  step?: string;
  current?: number;
  total?: number;
  done?: boolean;
  report?: ContentReport;
  error?: string;
};

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function priorityClasses(priority: string): string {
  if (priority === "high") return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  if (priority === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

function impactClasses(impact: string): string {
  if (impact === "high") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (impact === "medium") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

function ErrorBanner({ error }: { error: string }) {
  const labels: Record<string, string> = {
    access_denied: "You denied the Instagram authorization request.",
    missing_code_or_state: "Instagram did not return an authorization code.",
    code_exchange_failed: "Could not exchange the Instagram authorization code.",
    token_upgrade_failed: "Could not upgrade the Instagram token to a long-lived one.",
    token_store_failed: "Could not save the Instagram token. Please try again.",
    server_not_configured:
      "Instagram OAuth is not configured on this server. Set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET.",
  };
  return (
    <Alert variant="error" title="Instagram connection failed">
      {labels[error] ?? error}
    </Alert>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function HorizontalBars({ rows, maxRows = 5 }: { rows: Array<{ key: string; value: number }>; maxRows?: number }) {
  const visible = rows.slice(0, maxRows);
  const max = visible.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  if (visible.length === 0) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">No data yet.</div>;
  }
  return (
    <ul className="space-y-2">
      {visible.map((row) => (
        <li key={row.key}>
          <div className="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
            <span className="truncate pr-2">{row.key}</span>
            <span className="tabular-nums">{row.value.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-2 w-full rounded bg-gray-100 dark:bg-gray-800">
            <div
              className="h-2 rounded bg-primary"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PatternCard({
  pattern,
  onElaborate,
}: {
  pattern: Pattern;
  onElaborate: (p: Pattern) => void;
}) {
  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{pattern.title}</h3>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${impactClasses(pattern.impact)}`}>
              {pattern.impact} impact
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{pattern.description}</p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold">Evidence:</span> {pattern.evidence}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onElaborate(pattern)}>
          Elaborate
        </Button>
      </div>
    </Card>
  );
}

function InsightsContent() {
  const params = useSearchParams();
  const errorParam = params.get("error");
  const connectedParam = params.get("connected");

  const [account, setAccount] = useState<AccountState | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [insightsByPost, setInsightsByPost] = useState<Map<number, InsightRow>>(new Map());
  const [demographics, setDemographics] = useState<Demographics | null>(null);
  const [report, setReport] = useState<ContentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState<string>("");
  const [elaborate, setElaborate] = useState<{ pattern: Pattern; text: string | null; loading: boolean } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [accountRes, postsRes, insightsRes, demoRes, reportRes] = await Promise.all([
        fetch("/api/platforms/instagram/account"),
        fetch("/api/platforms/instagram/posts?limit=50"),
        fetch("/api/platforms/instagram/insights"),
        fetch("/api/platforms/instagram/demographics"),
        fetch("/api/analyze/instagram"),
      ]);

      if (accountRes.ok) setAccount(await accountRes.json());
      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts ?? []);
      }
      if (insightsRes.ok) {
        const data = await insightsRes.json();
        const map = new Map<number, InsightRow>();
        for (const row of data.insights ?? []) {
          if (!map.has(row.postId)) map.set(row.postId, row);
        }
        setInsightsByPost(map);
      }
      if (demoRes.ok) setDemographics(await demoRes.json());
      if (reportRes.ok) {
        const data = await reportRes.json();
        setReport(data.report ?? null);
      }
    } catch (err) {
      console.error("[insights] load failed", err);
      toast.error("Failed to load Instagram data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (connectedParam === "1") {
      toast.success("Instagram connected — running first sync…");
    }
  }, [connectedParam]);

  const handleConnect = () => {
    window.location.href = "/api/platforms/instagram/oauth/start";
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncStep("Starting...");
    try {
      const res = await fetch("/api/platforms/instagram/sync/stream");
      if (!res.ok || !res.body) {
        toast.error("Could not start sync");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let succeeded = false;
      let errorMessage: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              phase?: string;
              step?: string;
              error?: string;
            };
            if (event.step) setSyncStep(event.step);
            if (event.phase === "complete") succeeded = true;
            if (event.phase === "error") errorMessage = event.error ?? "Sync failed";
          } catch {
            // ignore parse errors
          }
        }
      }

      if (errorMessage) {
        toast.error(errorMessage);
      } else if (succeeded) {
        toast.success("Sync complete");
        await loadAll();
      } else {
        toast.error("Sync ended unexpectedly");
      }
    } catch (err) {
      console.error("[insights] sync failed", err);
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
      setSyncStep("");
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeStep("Starting...");
    try {
      const res = await fetch("/api/analyze/instagram/stream");
      if (!res.ok || !res.body) {
        toast.error("Could not start analysis stream");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const json = line.slice(6);
          try {
            const event: StreamEvent = JSON.parse(json);
            if (event.step) setAnalyzeStep(event.step);
            if (event.phase === "complete" && event.report) {
              setReport(event.report);
              toast.success("Analysis complete");
            }
            if (event.phase === "error") {
              toast.error(event.error || "Analysis failed");
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      console.error("[insights] analyze failed", err);
      toast.error("Analysis failed");
    } finally {
      setAnalyzing(false);
      setAnalyzeStep("");
    }
  };

  const handleElaborate = async (pattern: Pattern) => {
    setElaborate({ pattern, text: null, loading: true });
    try {
      const res = await fetch("/api/analyze/instagram/elaborate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pattern.title,
          description: pattern.description,
          evidence: pattern.evidence,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Elaboration failed");
        setElaborate(null);
        return;
      }
      const data = (await res.json()) as { elaboration: string };
      setElaborate({ pattern, text: data.elaboration, loading: false });
    } catch (err) {
      console.error("[insights] elaborate failed", err);
      toast.error("Elaboration failed");
      setElaborate(null);
    }
  };

  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => {
      const ea = insightsByPost.get(a.id)?.engagement ?? 0;
      const eb = insightsByPost.get(b.id)?.engagement ?? 0;
      return eb - ea;
    });
  }, [posts, insightsByPost]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {errorParam ? <ErrorBanner error={errorParam} /> : null}

      <Card padding="lg">
        {account?.connected ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Instagram
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Connected as @{account.username ?? account.accountId}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {formatNumber(account.snapshot?.media_count)} posts ·{" "}
                {formatNumber(account.snapshot?.follower_count)} followers
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button onClick={handleSync} loading={syncing} variant="primary">
                Sync now
              </Button>
              {syncing && syncStep ? (
                <div className="text-xs text-gray-500 dark:text-gray-400">{syncStep}</div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Connect your Instagram account
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                We&apos;ll pull your posts, insights, and audience demographics.
              </div>
            </div>
            <Button onClick={handleConnect} variant="primary">
              Connect Instagram
            </Button>
          </div>
        )}
      </Card>

      {account?.connected ? (
        <>
          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
              Account analytics
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Followers" value={formatNumber(account.snapshot?.follower_count)} />
              <Stat label="Posts" value={formatNumber(account.snapshot?.media_count)} />
              <Stat label="Reach (latest)" value={formatNumber(account.snapshot?.reach)} />
              <Stat label="Profile views" value={formatNumber(account.snapshot?.profile_views)} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
              Audience
            </h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Card title="Age × gender" padding="md">
                <HorizontalBars rows={demographics?.ageGender ?? []} maxRows={8} />
              </Card>
              <Card title="Top countries" padding="md">
                <HorizontalBars rows={demographics?.countries ?? []} maxRows={5} />
              </Card>
              <Card title="Top cities" padding="md">
                <HorizontalBars rows={demographics?.cities ?? []} maxRows={5} />
              </Card>
            </div>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                AI insights report
              </h2>
              <Button onClick={handleAnalyze} loading={analyzing} variant="primary" size="sm">
                {report ? "Re-run analysis" : "Run analysis"}
              </Button>
            </div>

            {analyzing ? (
              <Card padding="md">
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  {analyzeStep || "Working..."}
                </div>
              </Card>
            ) : null}

            {!report && !analyzing ? (
              <Card padding="md">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  No report yet. Click <strong>Run analysis</strong> to generate patterns and recommendations from your posts.
                </div>
              </Card>
            ) : null}

            {report ? (
              <div className="space-y-4">
                <Card padding="md">
                  <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Summary
                  </div>
                  <p className="mt-2 text-sm text-gray-900 dark:text-gray-100">{report.summary}</p>
                  <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    {report.postsAnalyzed} posts analyzed ·{" "}
                    {new Date(report.generatedAt).toLocaleString()}
                  </div>
                </Card>

                {report.patterns.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Patterns
                    </h3>
                    <div className="space-y-3">
                      {report.patterns.map((p, i) => (
                        <PatternCard key={i} pattern={p} onElaborate={handleElaborate} />
                      ))}
                    </div>
                  </div>
                ) : null}

                {report.recommendations.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Recommendations
                    </h3>
                    <div className="space-y-3">
                      {report.recommendations.map((r, i) => (
                        <Card key={i} padding="md">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                  {r.action}
                                </h4>
                                <span className={`rounded px-2 py-0.5 text-xs font-medium ${priorityClasses(r.priority)}`}>
                                  {r.priority} priority
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{r.reasoning}</p>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
              Recent posts
            </h2>
            {sortedPosts.length === 0 ? (
              <Card padding="md">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  No posts synced yet. Click <strong>Sync now</strong> above.
                </div>
              </Card>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sortedPosts.map((post) => {
                  const insight = insightsByPost.get(post.id);
                  return (
                    <li key={post.id}>
                      <Card padding="sm" className="overflow-hidden">
                        {post.thumbnail_url || post.media_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={post.thumbnail_url ?? post.media_url ?? ""}
                            alt={post.caption?.slice(0, 80) ?? "Instagram post"}
                            className="-mx-4 -mt-4 mb-3 aspect-square w-[calc(100%+2rem)] object-cover"
                          />
                        ) : null}
                        <div className="line-clamp-2 text-sm text-gray-900 dark:text-gray-100">
                          {post.caption ?? <em className="text-gray-500">No caption</em>}
                        </div>
                        <dl className="mt-3 grid grid-cols-3 gap-1 text-xs">
                          <div>
                            <dt className="text-gray-500 dark:text-gray-400">Reach</dt>
                            <dd className="font-medium text-gray-900 dark:text-gray-100">
                              {formatNumber(insight?.reach)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-gray-500 dark:text-gray-400">Views</dt>
                            <dd className="font-medium text-gray-900 dark:text-gray-100">
                              {formatNumber(insight?.impressions)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-gray-500 dark:text-gray-400">Saves</dt>
                            <dd className="font-medium text-gray-900 dark:text-gray-100">
                              {formatNumber(insight?.saves)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-gray-500 dark:text-gray-400">Shares</dt>
                            <dd className="font-medium text-gray-900 dark:text-gray-100">
                              {formatNumber(insight?.shares)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-gray-500 dark:text-gray-400">Likes</dt>
                            <dd className="font-medium text-gray-900 dark:text-gray-100">
                              {formatNumber(insight?.likes)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-gray-500 dark:text-gray-400">Comments</dt>
                            <dd className="font-medium text-gray-900 dark:text-gray-100">
                              {formatNumber(insight?.comments)}
                            </dd>
                          </div>
                        </dl>
                        {post.permalink ? (
                          <div className="mt-3 text-right">
                            <Link
                              href={post.permalink}
                              target="_blank"
                              className="text-xs text-primary hover:underline"
                            >
                              View on Instagram →
                            </Link>
                          </div>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {elaborate ? (
        <Modal
          open
          onClose={() => setElaborate(null)}
          title={elaborate.pattern.title}
          maxWidth="max-w-2xl"
        >
          {elaborate.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">
              {elaborate.text}
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href="/app"
        className="inline-flex items-center gap-1 mb-4 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to dashboard
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Insights</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Instagram analytics, audience demographics, and AI-generated content insights.
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <InsightsContent />
      </Suspense>
    </div>
  );
}
