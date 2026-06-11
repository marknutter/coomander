/**
 * OF wall-content prohibition checks (#153).
 *
 * When the creator logs a daily-vlog wall capture, scan the notes/description
 * for patterns that commonly violate OF ToS or hurt the sub experience. These
 * are SOFT warnings, never blockers — the creator can override. The pure checker
 * (checkWallProhibitions) takes text only and is unit-testable.
 *
 * Categories (from creator-research synthesis):
 *   - other_people:  content with others in frame can ban the account
 *   - drugs:         drugs / paraphernalia
 *   - age_coded:     binkies, pacifiers, plush with childlike framing (banned)
 *   - reposted_ig:   content already posted on IG (subs feel scammed)
 */

export interface WallWarning {
  code: "other_people" | "drugs" | "age_coded" | "reposted_ig";
  message: string;
}

interface Rule {
  code: WallWarning["code"];
  message: string;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    code: "other_people",
    message: "Heads up: OF bans content with other people in frame. Make sure it is solo, or you have their release on file.",
    patterns: [
      /\bwith (my |a |the |her |his |another )?(friend|friends|bf|boyfriend|girlfriend|gf|sister|roommate|someone|guy|girl|model)\b/i,
      /\b(we|us|together|threesome|collab|duo)\b/i,
      /\banother (person|girl|guy|model)\b/i,
    ],
  },
  {
    code: "drugs",
    message: "Heads up: drugs or paraphernalia in frame can get the account banned. Keep them out of the shot.",
    patterns: [/\b(weed|cannabis|joint|blunt|bong|vape pen|cocaine|coke|pills|drugs|paraphernalia)\b/i],
  },
  {
    code: "age_coded",
    message: "Heads up: age-coded items (pacifiers, binkies, childlike plush framing) are banned on OF. Leave them out.",
    patterns: [/\b(binky|binkie|pacifier|paci|plushie|stuffed animal|onesie|diaper|ddlg|age ?play)\b/i],
  },
  {
    code: "reposted_ig",
    message: "Heads up: reposting IG content to the wall makes subs feel scammed. Keep wall content exclusive.",
    patterns: [
      /\balready\b[^.!?]*\b(ig|insta|instagram)\b/i, // "already posted on IG", "already on insta"
      /\b(posted|up) (this )?(already )?on (ig|insta|instagram)\b/i,
      /\bsame as (my )?(ig|insta|instagram)\b/i,
      /\brepost(ed)? (from |to )?(ig|insta)\b/i,
    ],
  },
];

/** Return any prohibition warnings the text triggers (empty = clean). */
export function checkWallProhibitions(text: string | null | undefined): WallWarning[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const out: WallWarning[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(t))) out.push({ code: rule.code, message: rule.message });
  }
  return out;
}
