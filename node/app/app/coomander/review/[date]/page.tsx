"use client";

/**
 * /app/coomander/review/[date] — full weekly review (#154). Internal-grade.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Review {
  week_ending: string;
  pillars: Array<{ pillar: { name: string }; expected_total: number; actual_total: number; on_pace: boolean; platform_breakdown: Record<string, number> }>;
  procurement: { received_this_week: Array<{ label: string }>; overdue: Array<{ label: string }>; upcoming_next_2_weeks: Array<{ label: string }> };
  consistency: { longest_streak_days: number; days_with_zero_drops: number; bad_days: number };
  content_cushion_days_trend: { start_of_week: number; end_of_week: number };
  highlights: string[];
  drift: string[];
  next_week_focus: string;
  drift_questions: Array<{ question: string }>;
}

export default function ReviewPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/coomander/weekly-review?date=${encodeURIComponent(date)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setReview(data.review as Review | null);
      } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    })();
  }, [date]);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <Link href="/app/coomander" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
        <ArrowLeft className="w-4 h-4" /> Coomander
      </Link>
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Weekly review — {date}</h1>
      {loading && <Skeleton className="h-40 w-full" />}
      {error && <div className="text-sm text-red-900 bg-red-100 rounded p-3">{error}</div>}
      {!loading && !review && !error && <p className="text-sm text-gray-500">No review found for this week.</p>}

      {review && (
        <>
          <Card title="Content cushion">
            <p className="text-sm text-gray-800 dark:text-gray-200">
              {review.content_cushion_days_trend.start_of_week} → <strong>{review.content_cushion_days_trend.end_of_week}</strong> days
            </p>
          </Card>

          <Card title="Pillars">
            <div className="space-y-1 text-sm">
              {review.pillars.map((p) => (
                <div key={p.pillar.name} className="flex items-center gap-2">
                  <span className={p.on_pace ? "text-green-600" : "text-red-600"}>{p.on_pace ? "✓" : "⚠"}</span>
                  <span className="text-gray-900 dark:text-gray-100">{p.pillar.name}</span>
                  <span className="text-gray-500">{p.actual_total}/{p.expected_total}</span>
                  <span className="text-xs text-gray-400 ml-auto">{Object.entries(p.platform_breakdown).map(([k, v]) => `${k}:${v}`).join(" ")}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Consistency">
            <p className="text-sm text-gray-800 dark:text-gray-200">
              Longest streak {review.consistency.longest_streak_days}d · {review.consistency.days_with_zero_drops} zero-drop days · {review.consistency.bad_days} bad days
            </p>
          </Card>

          <Card title="Procurement">
            <div className="text-sm space-y-1 text-gray-800 dark:text-gray-200">
              <div>Received: {review.procurement.received_this_week.map((p) => p.label).join(", ") || "—"}</div>
              <div className="text-red-600">Overdue: {review.procurement.overdue.map((p) => p.label).join(", ") || "—"}</div>
              <div>Upcoming (2wk): {review.procurement.upcoming_next_2_weeks.map((p) => p.label).join(", ") || "—"}</div>
            </div>
          </Card>

          {(review.highlights.length > 0 || review.drift.length > 0 || review.next_week_focus) && (
            <Card title="Coomander's read">
              {review.highlights.length > 0 && <div className="text-sm mb-2"><strong className="text-green-700">Wins:</strong><ul className="list-disc ml-5">{review.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul></div>}
              {review.drift.length > 0 && <div className="text-sm mb-2"><strong className="text-amber-700">Drift:</strong><ul className="list-disc ml-5">{review.drift.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
              {review.next_week_focus && <p className="text-sm"><strong>Next week:</strong> {review.next_week_focus}</p>}
            </Card>
          )}

          {review.drift_questions.length > 0 && (
            <Card title="Questions Coomander asked">
              <ul className="list-disc ml-5 text-sm text-gray-800 dark:text-gray-200">
                {review.drift_questions.map((q, i) => <li key={i}>{q.question}</li>)}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
