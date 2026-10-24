import { extractJsonObject, oneLine } from "./json";
import type { EvalSummary } from "./evaluation";

/*
 * モデルカード (ストアの紹介文) の下書き。Nemotron の返事は形と長さを確かめてから画面に返し、
 * 作者が直してから保存する (ここでは保存しない)。
 */

export const CARD_TAGLINE_MAX = 160;
export const CARD_DESCRIPTION_MAX = 2_000;
export const CARD_TAG_MAX = 32;
export const CARD_TAGS_MAX = 6;
export const CARD_MAX_TOKENS = 3_000;

export type ModelCardDraft = { tagline: string; description: string; tags: string[] };

/** 返事を読む。tagline と description が無ければ null。長すぎる部分は切り詰める */
export function parseModelCardDraft(content: string): ModelCardDraft | null {
  const parsed = extractJsonObject(content);
  if (!parsed) return null;
  const { tagline, description, tags } = parsed as {
    tagline?: unknown;
    description?: unknown;
    tags?: unknown;
  };
  if (typeof tagline !== "string" || typeof description !== "string") return null;
  const cleanTagline = oneLine(tagline, CARD_TAGLINE_MAX);
  const cleanDescription = description.replace(/\r\n?/g, "\n").trim().slice(0, CARD_DESCRIPTION_MAX);
  if (!cleanTagline || !cleanDescription) return null;
  const cleanTags = Array.isArray(tags)
    ? [
        ...new Set(
          tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => oneLine(tag, CARD_TAG_MAX).replace(/^#/, "").toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, CARD_TAGS_MAX)
    : [];
  return { tagline: cleanTagline, description: cleanDescription, tags: cleanTags };
}

/** 評価の要約を、下書き用の短い平文にする (数字はこのまま引用させる) */
export function describeEvaluation(
  summary: EvalSummary,
  models: { baseline: string; judge: string },
) {
  const lines = [
    `Held-out questions graded: ${summary.n}`,
    `Average score (1-5) of this model: ${summary.fineTunedMean}`,
    `Average score of the baseline ${models.baseline}: ${summary.baseMean}`,
    `Wins/ties/losses against the baseline: ${summary.wins}/${summary.ties}/${summary.losses}`,
    `Sign test p-value: ${summary.signTestP}`,
    `Conclusion: ${
      summary.verdict === "better"
        ? "better than the baseline on this set"
        : summary.verdict === "worse"
          ? "worse than the baseline on this set"
          : summary.verdict === "too_few"
            ? "too few questions to conclude"
            : "no clear difference"
    }`,
    `Grader: ${models.judge}`,
  ];
  return lines.join("\n");
}
