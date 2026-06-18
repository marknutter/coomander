import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { queryFirst } from "@/lib/db-helpers";
import {
  contentInsights,
  postAnalysis,
  postInsights,
  posts,
} from "@/lib/schema";

const PLATFORM = "instagram";

function getClient(): Anthropic {
  return new Anthropic();
}

// ── Types ────────────────────────────────────────────────────────────

interface VisualAnalysis {
  setting: string;
  lighting: string;
  face_visible: boolean;
  text_overlay: boolean;
  visual_style: string;
}

interface CaptionAnalysis {
  hookType: string;
  ctaPresent: boolean;
  ctaType: string;
  captionTone: string;
}

export interface ContentReport {
  patterns: Array<{
    title: string;
    description: string;
    evidence: string;
    impact: string;
  }>;
  recommendations: Array<{
    action: string;
    reasoning: string;
    priority: "high" | "medium" | "low";
  }>;
  summary: string;
  postsAnalyzed: number;
  generatedAt: string;
}

export type ProgressCallback = (event: {
  phase: string;
  step: string;
  current: number;
  total: number;
}) => void;

export interface AnalyzeResult {
  analyzed: number;
  skipped: number;
  errors: number;
}

// ── Single post analysis ─────────────────────────────────────────────

async function analyzePostVisual(imageUrl: string): Promise<VisualAnalysis> {
  const response = await getClient().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "url", url: imageUrl },
        },
        {
          type: "text",
          text: `Analyze this Instagram post image. Return ONLY a JSON object with these fields:
- "setting": one of "indoor", "outdoor", "studio", "car", "mixed"
- "lighting": one of "natural", "artificial", "dramatic", "mixed"
- "face_visible": boolean, is a human face clearly visible
- "text_overlay": boolean, is there text overlaid on the image
- "visual_style": a brief 3-5 word description of the visual aesthetic

Return only the JSON, no other text.`,
        },
      ],
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return { setting: "unknown", lighting: "unknown", face_visible: false, text_overlay: false, visual_style: "unknown" };
  }

  return JSON.parse(jsonMatch[0]) as VisualAnalysis;
}

function analyzeCaptionStructure(caption: string): CaptionAnalysis & {
  emojiCount: number;
  hashtagCount: number;
  captionLength: number;
} {
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
  const emojiCount = (caption.match(emojiRegex) ?? []).length;
  const hashtagCount = (caption.match(/#\w+/g) ?? []).length;
  const captionLength = caption.length;

  const firstLine = caption.split(/[.\n!?]/)[0]?.trim() ?? "";
  let hookType = "statement";
  if (firstLine.includes("?")) hookType = "question";
  else if (/^(link|click|tap|dm|check)/i.test(firstLine)) hookType = "cta";
  else if (/\.\.\.|👀|🤫|😏|guess|wait|ready/i.test(firstLine)) hookType = "teaser";

  const lowerCaption = caption.toLowerCase();
  let ctaPresent = false;
  let ctaType = "none";
  if (/link in bio|link in my bio|bio link/i.test(lowerCaption)) { ctaPresent = true; ctaType = "link_in_bio"; }
  else if (/dm me|send me a dm|message me/i.test(lowerCaption)) { ctaPresent = true; ctaType = "dm"; }
  else if (/follow|subscribe/i.test(lowerCaption)) { ctaPresent = true; ctaType = "follow"; }

  let captionTone = "casual";
  if (/\b(tip|how to|here's|learn|guide)\b/i.test(caption)) captionTone = "informational";
  else if (/😏|🔥|👀|💋|dare|tease|maybe|promise/i.test(caption)) captionTone = "provocative";
  else if (/\b(i feel|my|honestly|real talk|personal)\b/i.test(caption)) captionTone = "personal";

  return { hookType, ctaPresent, ctaType, captionTone, emojiCount, hashtagCount, captionLength };
}

export { analyzePostVisual, analyzeCaptionStructure };

// ── Batch analysis ───────────────────────────────────────────────────

export async function analyzeUnanalyzedPosts(
  userId: string,
  limit = 500,
  onProgress?: ProgressCallback,
): Promise<AnalyzeResult> {
  const db = getDb();

  const unanalyzed = await db
    .select({
      id: posts.id,
      caption: posts.caption,
      media_type: posts.media_type,
      thumbnail_url: posts.thumbnail_url,
      media_url: posts.media_url,
    })
    .from(posts)
    .leftJoin(postAnalysis, eq(postAnalysis.post_id, posts.id))
    .where(and(eq(posts.user_id, userId), isNull(postAnalysis.id)))
    .limit(limit);

  let analyzed = 0;
  let errors = 0;

  for (let i = 0; i < unanalyzed.length; i++) {
    const post = unanalyzed[i];
    onProgress?.({
      phase: "analyze",
      step: `Analyzing post ${i + 1} of ${unanalyzed.length}`,
      current: i + 1,
      total: unanalyzed.length,
    });

    try {
      const imageUrl = post.media_type === "VIDEO" ? post.thumbnail_url : (post.media_url ?? post.thumbnail_url);
      let visual: VisualAnalysis = {
        setting: "unknown",
        lighting: "unknown",
        face_visible: false,
        text_overlay: false,
        visual_style: "unknown",
      };

      if (imageUrl) {
        try {
          visual = await analyzePostVisual(imageUrl);
        } catch {
          // Vision analysis failed — continue with defaults
        }
      }

      const caption = post.caption ?? "";
      const captionAttrs = analyzeCaptionStructure(caption);

      await db.insert(postAnalysis).values({
        user_id: userId,
        post_id: post.id,
        setting: visual.setting,
        lighting: visual.lighting,
        face_visible: visual.face_visible,
        text_overlay: visual.text_overlay,
        visual_style: visual.visual_style,
        caption_length: captionAttrs.captionLength,
        hook_type: captionAttrs.hookType,
        cta_present: captionAttrs.ctaPresent,
        cta_type: captionAttrs.ctaType,
        caption_tone: captionAttrs.captionTone,
        emoji_count: captionAttrs.emojiCount,
        hashtag_count: captionAttrs.hashtagCount,
        raw_analysis: JSON.stringify({ visual, caption: captionAttrs }),
      });

      analyzed++;
    } catch {
      errors++;
    }
  }

  const skipped = unanalyzed.length - analyzed - errors;
  return { analyzed, skipped, errors };
}

// ── Pattern correlation + report generation ──────────────────────────

export async function generateContentReport(
  userId: string,
  onProgress?: ProgressCallback,
): Promise<ContentReport> {
  onProgress?.({ phase: "report", step: "Generating pattern report...", current: 0, total: 1 });

  const db = getDb();

  const rows = await db
    .select({
      id: posts.id,
      caption: posts.caption,
      media_type: posts.media_type,
      published_at: posts.published_at,
      setting: postAnalysis.setting,
      lighting: postAnalysis.lighting,
      face_visible: postAnalysis.face_visible,
      text_overlay: postAnalysis.text_overlay,
      visual_style: postAnalysis.visual_style,
      hook_type: postAnalysis.hook_type,
      cta_present: postAnalysis.cta_present,
      caption_tone: postAnalysis.caption_tone,
      emoji_count: postAnalysis.emoji_count,
      transcript: postAnalysis.transcript,
      spoken_hook: postAnalysis.spoken_hook,
      key_frame_analysis: postAnalysis.key_frame_analysis,
      impressions: postInsights.impressions,
      reach: postInsights.reach,
      engagement: postInsights.engagement,
      saves: postInsights.saves,
      likes: postInsights.likes,
      comments: postInsights.comments,
      shares: postInsights.shares,
    })
    .from(posts)
    .innerJoin(postAnalysis, eq(postAnalysis.post_id, posts.id))
    .innerJoin(postInsights, eq(postInsights.post_id, posts.id))
    .where(eq(posts.user_id, userId));

  if (rows.length < 5) {
    const emptyReport: ContentReport = {
      patterns: [],
      recommendations: [],
      summary: "Not enough analyzed posts to generate meaningful patterns. Need at least 5 posts with both analysis and insights data.",
      postsAnalyzed: rows.length,
      generatedAt: new Date().toISOString(),
    };
    return emptyReport;
  }

  const reportRows = rows.map((r) => ({
    caption: r.caption,
    mediaType: r.media_type,
    publishedAt: r.published_at,
    setting: r.setting,
    lighting: r.lighting,
    faceVisible: r.face_visible,
    textOverlay: r.text_overlay,
    visualStyle: r.visual_style,
    hookType: r.hook_type,
    ctaPresent: r.cta_present,
    captionTone: r.caption_tone,
    emojiCount: r.emoji_count,
    transcript: r.transcript,
    spokenHook: r.spoken_hook,
    keyFrameAnalysis: r.key_frame_analysis,
    impressions: r.impressions,
    reach: r.reach,
    engagement: r.engagement,
    saves: r.saves,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
  }));

  const dataSummary = {
    totalPosts: reportRows.length,
    byMediaType: groupAndAverage(reportRows, "mediaType"),
    bySetting: groupAndAverage(reportRows, "setting"),
    byLighting: groupAndAverage(reportRows, "lighting"),
    byFaceVisible: groupAndAverage(reportRows, "faceVisible"),
    byTextOverlay: groupAndAverage(reportRows, "textOverlay"),
    byHookType: groupAndAverage(reportRows, "hookType"),
    byCtaPresent: groupAndAverage(reportRows, "ctaPresent"),
    byCaptionTone: groupAndAverage(reportRows, "captionTone"),
    topPosts: [...reportRows]
      .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
      .slice(0, 10)
      .map((r) => ({
        caption: r.caption?.slice(0, 80),
        mediaType: r.mediaType,
        setting: r.setting,
        lighting: r.lighting,
        hookType: r.hookType,
        captionTone: r.captionTone,
        spokenHook: r.spokenHook,
        transcript: r.transcript?.slice(0, 150),
        keyFrameHighlights: parseKeyFrameHighlights(r.keyFrameAnalysis),
        engagement: r.engagement,
        reach: r.reach,
        saves: r.saves,
      })),
    bottomPosts: [...reportRows]
      .sort((a, b) => (a.engagement ?? 0) - (b.engagement ?? 0))
      .slice(0, 10)
      .map((r) => ({
        caption: r.caption?.slice(0, 80),
        mediaType: r.mediaType,
        setting: r.setting,
        lighting: r.lighting,
        hookType: r.hookType,
        captionTone: r.captionTone,
        spokenHook: r.spokenHook,
        transcript: r.transcript?.slice(0, 150),
        keyFrameHighlights: parseKeyFrameHighlights(r.keyFrameAnalysis),
        engagement: r.engagement,
        reach: r.reach,
        saves: r.saves,
      })),
  };

  const response = await getClient().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are a senior social media strategist analyzing Instagram content performance data for a creator. Your job is to find non-obvious, actionable patterns — not surface-level observations anyone could see in Instagram's own analytics.

DATA SUMMARY (${dataSummary.totalPosts} posts analyzed):
${JSON.stringify(dataSummary, null, 2)}

Return ONLY a JSON object with this structure:
{
  "patterns": [
    {
      "title": "short pattern name",
      "description": "A detailed 2-3 sentence explanation of the pattern. Explain WHY this matters, not just what the numbers show. Connect it to audience psychology or content strategy principles.",
      "evidence": "Exact numbers: averages, comparisons, sample sizes. Always include how many posts are in each group so the reader can judge statistical significance.",
      "impact": "high/medium/low"
    }
  ],
  "recommendations": [
    {
      "action": "A specific, concrete action — not vague advice like 'post more reels'. Say exactly what to do, when, and how.",
      "reasoning": "2-3 sentences explaining the data-backed reasoning AND the strategic logic. Reference specific numbers from the patterns.",
      "priority": "high/medium/low"
    }
  ],
  "summary": "3-4 sentence executive summary. Lead with the single most important finding, then the biggest opportunity, then the biggest risk."
}

Rules:
- Be specific with ALL numbers. Always cite sample sizes.
- Go beyond the obvious. "Videos get more engagement" is useless. "Videos with face visible in natural light get 3.2x saves vs studio shots" is useful.
- Cross-reference attributes: don't just look at one dimension. The best insights combine visual + caption + timing patterns.
- If sample sizes are small (under 5 posts in a group), flag that explicitly as low confidence.
- 4-6 patterns and 4-6 recommendations.`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let report: ContentReport;

  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    report = {
      ...parsed,
      postsAnalyzed: rows.length,
      generatedAt: new Date().toISOString(),
    };
  } else {
    report = {
      patterns: [],
      recommendations: [],
      summary: "Failed to generate report. Please try again.",
      postsAnalyzed: rows.length,
      generatedAt: new Date().toISOString(),
    };
  }

  await db.insert(contentInsights).values({
    user_id: userId,
    platform: PLATFORM,
    report_json: JSON.stringify(report),
    posts_analyzed: rows.length,
  });

  return report;
}

// ── Get latest report ────────────────────────────────────────────────

export async function getLatestReport(userId: string): Promise<ContentReport | null> {
  const db = getDb();
  const row = await queryFirst(
    db
      .select()
      .from(contentInsights)
      .where(and(eq(contentInsights.user_id, userId), eq(contentInsights.platform, PLATFORM)))
      .orderBy(desc(contentInsights.created_at))
      .limit(1),
  );

  if (!row) return null;
  return JSON.parse(row.report_json) as ContentReport;
}

// ── Elaborate on a pattern ────────────────────────────────────────────

export async function elaboratePattern(
  userId: string,
  pattern: { title: string; description: string; evidence: string },
): Promise<string> {
  const db = getDb();

  const rows = await db
    .select({
      caption: posts.caption,
      media_type: posts.media_type,
      setting: postAnalysis.setting,
      lighting: postAnalysis.lighting,
      hook_type: postAnalysis.hook_type,
      caption_tone: postAnalysis.caption_tone,
      engagement: postInsights.engagement,
      reach: postInsights.reach,
      saves: postInsights.saves,
      likes: postInsights.likes,
      shares: postInsights.shares,
    })
    .from(posts)
    .innerJoin(postAnalysis, eq(postAnalysis.post_id, posts.id))
    .innerJoin(postInsights, eq(postInsights.post_id, posts.id))
    .where(eq(posts.user_id, userId))
    .orderBy(desc(postInsights.engagement))
    .limit(20);

  const response = await getClient().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: `You are a senior social media strategist. A content analysis found this pattern:

PATTERN: ${pattern.title}
DESCRIPTION: ${pattern.description}
EVIDENCE: ${pattern.evidence}

Here are the top 20 posts by engagement for context:
${JSON.stringify(rows.map((r) => ({
  caption: r.caption?.slice(0, 100),
  type: r.media_type,
  setting: r.setting,
  lighting: r.lighting,
  hook: r.hook_type,
  tone: r.caption_tone,
  engagement: r.engagement,
  reach: r.reach,
  saves: r.saves,
})), null, 2)}

Provide a detailed deep-dive on this pattern. Include:
1. WHY this pattern likely exists (audience psychology, algorithm behavior, platform dynamics)
2. Specific examples from the post data that illustrate it
3. A concrete content playbook: exactly what to do in the next 5 posts to leverage this pattern
4. What to watch out for (diminishing returns, audience fatigue, etc.)

Write in a direct, strategic tone. Be specific — reference actual captions and numbers from the data. 3-4 paragraphs.`,
    }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "Failed to generate elaboration.";
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseKeyFrameHighlights(json: string | null): string | null {
  if (!json || json === "{}") return null;
  try {
    const parsed = JSON.parse(json);
    return `${parsed.appearance ?? ""} | ${parsed.location ?? ""} | ${parsed.energy ?? ""} energy`.trim();
  } catch {
    return null;
  }
}

function groupAndAverage(
  rows: Array<Record<string, unknown>>,
  groupBy: string,
): Array<{ group: string; count: number; avgEngagement: number; avgReach: number; avgSaves: number }> {
  const groups = new Map<string, { count: number; totalEngagement: number; totalReach: number; totalSaves: number }>();

  for (const row of rows) {
    const key = String(row[groupBy] ?? "unknown");
    const existing = groups.get(key) ?? { count: 0, totalEngagement: 0, totalReach: 0, totalSaves: 0 };
    existing.count++;
    existing.totalEngagement += (row.engagement as number) ?? 0;
    existing.totalReach += (row.reach as number) ?? 0;
    existing.totalSaves += (row.saves as number) ?? 0;
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([group, data]) => ({
      group,
      count: data.count,
      avgEngagement: Math.round(data.totalEngagement / data.count),
      avgReach: Math.round(data.totalReach / data.count),
      avgSaves: Math.round(data.totalSaves / data.count),
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);
}
