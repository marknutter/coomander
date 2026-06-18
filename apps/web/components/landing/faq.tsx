"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

interface FaqItem {
  question: string;
  answer: string;
}

const faqs: FaqItem[] = [
  {
    question: "What does Coomander actually do?",
    answer:
      "Coomander pulls your Instagram posts and audience data, runs each post through Claude vision and caption parsing, transcribes your reels (Pro), and then joins it all to your performance data to surface the patterns that actually predict engagement — with strategist-grade explanations you can act on.",
  },
  {
    question: "Is my Instagram data safe?",
    answer:
      "Coomander connects with read-only OAuth permissions — it can see your posts, audience demographics, and Instagram-provided insights, but it can't post, message, or change anything. Your data is stored per-user in our database and never used to train any model.",
  },
  {
    question: "Which Instagram accounts work?",
    answer:
      "Instagram Business or Creator accounts connected to a Facebook Page. Personal accounts can't expose the Insights API that powers the reach / saves / shares / demographics data, so they're not supported. Switching to a Creator account is free and takes about a minute in the IG app.",
  },
  {
    question: "How is this different from Instagram's own analytics?",
    answer:
      "Instagram tells you the numbers. Coomander tells you why. The native dashboard shows reach and impressions in isolation — Coomander cross-references visual style, hook type, caption tone, on-camera energy, and audience demographics to show you the combinations that actually drive saves and shares.",
  },
  {
    question: "What's the difference between Free and Pro?",
    answer:
      "Free covers image + caption analysis end-to-end, including pattern reports, recommendations, and the pattern deep-dive elaborations. Pro adds reel transcription via OpenAI Whisper, spoken-hook extraction, key-frame visual analysis (5 frames per video sent to Claude as a sequence), unlimited re-runs, and priority support.",
  },
  {
    question: "How often does it sync?",
    answer:
      "You can sync any time from the dashboard, and the sync runs in the background so you can keep using the app. Insights snapshots are stored historically per day so you can look at trends, not just the current numbers.",
  },
  {
    question: "Will you support other platforms?",
    answer:
      "Yes — TikTok and Reddit are on the roadmap. Pro subscribers get early access. We're building Coomander one platform at a time so each integration is actually deep instead of broadly shallow.",
  },
  {
    question: "Can I cancel any time?",
    answer:
      "Yes. Pro is month-to-month, cancel any time from the billing portal. Your Free plan stays usable, and all your data and past reports remain accessible.",
  },
];

/**
 * Accordion-style FAQ section.
 * Each item toggles open/closed independently.
 */
export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="max-w-2xl mx-auto divide-y divide-gray-200 dark:divide-gray-700">
      {faqs.map((faq, i) => (
        <div key={i} className="py-5">
          <button
            onClick={() => toggle(i)}
            className="flex items-center justify-between w-full text-left gap-4 group"
            aria-expanded={openIndex === i}
          >
            <span className="text-base font-medium text-gray-900 dark:text-gray-100 group-hover:text-primary/80 dark:group-hover:text-primary/80 transition-colors">
              {faq.question}
            </span>
            <ChevronDown
              className={cn(
                "w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0 transition-transform duration-200",
                openIndex === i && "rotate-180"
              )}
            />
          </button>
          <div
            className={cn(
              "grid transition-all duration-200 ease-out",
              openIndex === i ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0"
            )}
          >
            <div className="overflow-hidden">
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {faq.answer}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
