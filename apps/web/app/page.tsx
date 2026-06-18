import Link from "next/link";
import {
  Sparkles,
  Eye,
  Mic,
  Image as ImageIcon,
  Users,
  BarChart3,
  Brain,
  Compass,
  Smartphone,
  ArrowRight,
  Check,
  Star,
  Instagram,
} from "lucide-react";
import { LandingHeader } from "@/components/landing/header";
import { Faq } from "@/components/landing/faq";
import { NewsletterSignup } from "@/components/landing/newsletter";
import { WaitlistSignup } from "@/components/landing/waitlist-signup";

const WAITLIST_MODE = process.env.NEXT_PUBLIC_WAITLIST_MODE === "true";

/* ---------- JSON-LD Structured Data ---------- */

const siteUrl = process.env.BETTER_AUTH_URL || "https://coomander.com";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Coomander",
      url: siteUrl,
      logo: `${siteUrl}/icon.png`,
      description:
        "AI-powered Instagram analytics for creators — visual analysis, audience demographics, video transcription, and data-backed content recommendations.",
    },
    {
      "@type": "WebSite",
      name: "Coomander",
      url: siteUrl,
    },
    {
      "@type": "SoftwareApplication",
      name: "Coomander",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      offers: [
        {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Free plan — connect Instagram and run analyses",
        },
        {
          "@type": "Offer",
          price: "29",
          priceCurrency: "USD",
          description: "Pro plan — video transcription and unlimited analyses",
        },
      ],
    },
  ],
};

/* ---------- Data ---------- */

const features = [
  {
    icon: Eye,
    title: "Visual analysis",
    description:
      "Every post is graded for setting, lighting, face visibility, on-image text, and visual style — so you can see what your camera is actually doing.",
  },
  {
    icon: Brain,
    title: "Caption parsing",
    description:
      "Hook type, CTA presence, tone, emoji and hashtag density — Coomander reads every caption and tells you what's converting and what isn't.",
  },
  {
    icon: Mic,
    title: "Video transcription",
    description:
      "Reels and stories are transcribed end-to-end, with the spoken hook extracted from the first 15 words so you can A/B test openers.",
  },
  {
    icon: ImageIcon,
    title: "Key-frame analysis",
    description:
      "Five frames per reel are pulled and sent to Claude vision as a sequence — appearance, location, energy, scene changes, and visual narrative.",
  },
  {
    icon: Compass,
    title: "Pattern detection",
    description:
      "Cross-references visual + caption + engagement signals to find the non-obvious patterns Instagram's analytics will never show you.",
  },
  {
    icon: BarChart3,
    title: "Per-post insights",
    description:
      "Reach, impressions, saves, shares, likes, and comments for every post — pulled directly from the Instagram Graph API and stored historically.",
  },
  {
    icon: Users,
    title: "Audience demographics",
    description:
      "Age × gender, top countries, and top cities — refreshed on every sync so you know who's actually watching.",
  },
  {
    icon: Sparkles,
    title: "Pattern deep-dives",
    description:
      "Click any pattern for a strategist-grade explanation: why it exists, what posts illustrate it, a concrete content playbook, and what to watch out for.",
  },
];

const steps = [
  {
    step: "01",
    title: "Connect Instagram",
    description:
      "One-tap OAuth — Coomander pulls your posts, audience demographics, and per-post insights with read-only permissions.",
  },
  {
    step: "02",
    title: "Sync your data",
    description:
      "Backfill happens automatically. Re-sync any time to pull the latest posts and insight snapshots.",
  },
  {
    step: "03",
    title: "Run AI analysis",
    description:
      "Click Run analysis on the insights page. Claude reads every image, transcribes every reel, and returns a playbook tailored to your data.",
  },
];

const pricingPlans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Everything you need to understand your account.",
    badge: null as string | null,
    features: [
      "Connect one Instagram account",
      "Per-post insights (reach, saves, shares, likes, comments)",
      "Audience demographics",
      "AI visual + caption analysis",
      "Pattern reports + recommendations",
      "Pattern deep-dive elaborations",
      "Mobile-friendly dashboard",
    ],
    cta: "Get Started Free",
    href: "/auth?tab=signup",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$29",
    period: "month",
    description: "Add video — transcripts, key frames, and unlimited analyses.",
    badge: "CREATOR PLAN",
    features: [
      "Everything in Free, plus:",
      "Reel transcription (OpenAI Whisper)",
      "Spoken-hook extraction",
      "Key-frame visual analysis (5 frames per video)",
      "Unlimited re-runs",
      "Priority support",
      "Early access to new platforms (TikTok, Reddit)",
    ],
    cta: "Upgrade to Pro",
    href: "/auth?tab=signup",
    highlighted: true,
  },
];

const testimonials = [
  {
    quote:
      "I've been guessing at what my audience wants for two years. Coomander told me in one report — the patterns were obvious once it laid them out.",
    author: "Jordan R.",
    role: "Lifestyle creator · 180K followers",
    avatar: "JR",
  },
  {
    quote:
      "The video transcription alone is worth it. Seeing my spoken hooks side-by-side with the reels that actually performed changed how I open every reel now.",
    author: "Tasha L.",
    role: "Beauty creator · 420K followers",
    avatar: "TL",
  },
  {
    quote:
      "Pattern deep-dives feel like having a strategist on retainer. It doesn't just say 'post more reels' — it tells me exactly what kind, when, and why.",
    author: "Maya P.",
    role: "Fitness creator · 95K followers",
    avatar: "MP",
  },
];

/* ---------- Page ---------- */

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 scroll-smooth">
      <JsonLd data={jsonLd} />
      <LandingHeader />

      {/* ───── Hero ───── */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/50 via-white to-white /20 dark:via-gray-950 dark:to-gray-950" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/10 rounded-full blur-3xl" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-accent border border-accent text-accent-foreground text-xs font-medium px-3 py-1.5 rounded-full mb-8">
            <Sparkles className="w-3.5 h-3.5" />
            AI insights for Instagram creators
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 dark:text-gray-50 tracking-tight leading-[1.1] mb-6">
            Stop guessing what your
            <br />
            <span className="text-primary">audience wants.</span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Coomander reads every post, transcribes every reel, and tells you the
            non-obvious patterns driving your engagement — with a strategist-grade
            explanation for each one.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {!WAITLIST_MODE && (
              <Link
                href="/auth?tab=signup"
                className="inline-flex items-center gap-2 bg-primary text-white px-7 py-3.5 rounded-xl font-semibold hover:bg-primary/90 transition-colors text-base shadow-lg shadow-primary/20"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            {WAITLIST_MODE && (
              <a
                href="#waitlist"
                className="inline-flex items-center gap-2 bg-primary text-white px-7 py-3.5 rounded-xl font-semibold hover:bg-primary/90 transition-colors text-base shadow-lg shadow-primary/20"
              >
                Join the Waitlist
                <ArrowRight className="w-4 h-4" />
              </a>
            )}
            <a
              href="#features"
              className="inline-flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-7 py-3.5 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-base"
            >
              See what&apos;s analyzed
            </a>
          </div>

          <div className="mt-14 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm text-gray-400 dark:text-gray-500">
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className="w-4 h-4 fill-amber-400 text-amber-400"
                />
              ))}
              <span className="ml-1.5">Built by creators, for creators</span>
            </div>
            <span className="hidden sm:block">·</span>
            <span>Powered by Claude vision &amp; OpenAI Whisper</span>
          </div>
        </div>
      </section>

      {/* ───── Features ───── */}
      <section id="features" className="py-20 sm:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              Every signal Instagram won&apos;t show you
            </h2>
            <p className="mt-4 text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              Coomander joins your post performance to AI analysis of every image,
              caption, and reel — then surfaces the patterns that actually predict
              engagement.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group p-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-primary/90 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── How It Works ───── */}
      <section
        id="how-it-works"
        className="py-20 sm:py-28 bg-gray-50 dark:bg-gray-900"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              From connect to insights in 3 steps
            </h2>
            <p className="mt-4 text-lg text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              No setup. No CSV exports. No prompt engineering. Just sign in and run.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            {steps.map((s, i) => (
              <div key={s.step} className="relative text-center md:text-left">
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[calc(50%+40px)] w-[calc(100%-40px)] h-px bg-gradient-to-r from-primary to-transparent" />
                )}
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent mb-5">
                  <span className="text-2xl font-bold text-primary">
                    {s.step}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {s.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Pricing ───── */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              Simple, creator-friendly pricing
            </h2>
            <p className="mt-4 text-lg text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              Start free with image + caption analysis. Upgrade when you want to
              decode your reels.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-8 ${
                  plan.highlighted
                    ? "bg-primary text-white ring-4 ring-ring/20 /20 shadow-xl shadow-primary/20"
                    : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-900 text-xs font-bold px-3 py-1 rounded-full">
                    {plan.badge ?? "MOST POPULAR"}
                  </div>
                )}

                <h3
                  className={`text-lg font-semibold mb-1 ${
                    plan.highlighted
                      ? "text-white"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {plan.name}
                </h3>
                <p
                  className={`text-sm mb-5 ${
                    plan.highlighted
                      ? "text-accent-foreground"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {plan.description}
                </p>

                <div className="flex items-baseline gap-1 mb-6">
                  <span
                    className={`text-4xl font-extrabold ${
                      plan.highlighted
                        ? "text-white"
                        : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span
                    className={`text-sm ${
                      plan.highlighted
                        ? "text-accent-foreground"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    /{plan.period}
                  </span>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <Check
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          plan.highlighted
                            ? "text-accent-foreground"
                            : "text-primary"
                        }`}
                      />
                      <span
                        className={
                          plan.highlighted
                            ? "text-accent-foreground"
                            : "text-gray-600 dark:text-gray-300"
                        }
                      >
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={`block w-full text-center py-3 px-6 rounded-xl font-semibold text-sm transition-colors ${
                    plan.highlighted
                      ? "bg-white text-primary hover:bg-primary/90"
                      : "bg-primary text-white hover:bg-primary/90"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Testimonials ───── */}
      <section className="py-20 sm:py-28 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              Trusted by creators who care about the data
            </h2>
            <p className="mt-4 text-lg text-gray-500 dark:text-gray-400">
              What creators say after their first Coomander report.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div
                key={t.author}
                className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm"
              >
                <div className="flex items-center gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className="w-4 h-4 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <blockquote className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-5">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-accent-foreground">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {t.author}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {t.role}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── FAQ ───── */}
      <section id="faq" className="py-20 sm:py-28">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              Frequently asked questions
            </h2>
            <p className="mt-4 text-lg text-gray-500 dark:text-gray-400">
              Everything you need to know about Coomander.
            </p>
          </div>

          <Faq />
        </div>
      </section>

      {/* ───── Waitlist / Newsletter ───── */}
      {WAITLIST_MODE ? (
        <div id="waitlist">
          <WaitlistSignup />
        </div>
      ) : (
        <NewsletterSignup />
      )}

      {/* ───── CTA Footer ───── */}
      <section className="py-20 sm:py-28 bg-gradient-to-br from-primary to-primary ">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <Sparkles className="w-10 h-10 text-accent-foreground mx-auto mb-6" />
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
            Ready to know your audience?
          </h2>
          <p className="text-lg text-accent-foreground mb-8 max-w-lg mx-auto">
            Connect Instagram, run your first analysis, and read the patterns in
            under five minutes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {WAITLIST_MODE ? (
              <a
                href="#waitlist"
                className="inline-flex items-center gap-2 bg-white text-primary px-7 py-3.5 rounded-xl font-semibold hover:bg-primary/90 transition-colors text-base"
              >
                Join the Waitlist
                <ArrowRight className="w-4 h-4" />
              </a>
            ) : (
              <Link
                href="/auth?tab=signup"
                className="inline-flex items-center gap-2 bg-white text-primary px-7 py-3.5 rounded-xl font-semibold hover:bg-primary/90 transition-colors text-base"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ───── Footer ───── */}
      <footer className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="font-bold text-gray-900 dark:text-gray-100">
                  Coomander
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                AI-powered Instagram analytics — visual analysis, audience
                demographics, and creator-grade content recommendations.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Product
              </h4>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                <li>
                  <a href="#features" className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                    Pricing
                  </a>
                </li>
                <li>
                  <Link href="/blog" className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="/changelog" className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                    Changelog
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Legal
              </h4>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                <li>
                  <Link href="/privacy-policy" className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                    Terms of Service
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Connect
              </h4>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                <li>
                  <a
                    href="https://instagram.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                  >
                    <Instagram className="w-3.5 h-3.5" />
                    Instagram
                  </a>
                </li>
                <li>
                  <a
                    href="https://twitter.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                  >
                    Twitter
                  </a>
                </li>
                <li>
                  <a
                    href="mailto:hello@coomander.com"
                    className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                  >
                    Email
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              &copy; {new Date().getFullYear()} Coomander. All rights reserved.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              <Smartphone className="inline w-3 h-3 mr-1" />
              Built mobile-first for the way creators actually work.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data);
  const props: React.ScriptHTMLAttributes<HTMLScriptElement> & {
    [key: string]: unknown;
  } = { type: "application/ld+json" };
  // JSON-LD requires server-rendered raw JSON in the script body.
  // The data is a static literal serialized via JSON.stringify (no untrusted input).
  props["dangerouslySetInnerHTML"] = { __html: json };
  return <script {...props} />;
}
