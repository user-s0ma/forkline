import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import {
  isFineTuneActive,
  listBaseModels,
  listFineTunes,
} from "@/lib/api-client";
import type { DatasetIssue } from "@/lib/models/dataset";

/** 学習中は、この間隔で状態を問い合わせる */
const POLL_MS = 10_000;

export function useBaseModels() {
  return useQuery({
    queryKey: ["base-models"],
    queryFn: () => listBaseModels(),
    staleTime: 5 * 60_000,
  });
}

export function useFineTunes(modelId: string) {
  return useQuery({
    queryKey: ["fine-tunes", modelId],
    queryFn: () => listFineTunes(modelId),
    refetchInterval: (query) =>
      query.state.data?.items.some(isFineTuneActive) ? POLL_MS : false,
  });
}

export function datasetIssueText(t: TFunction, issue: DatasetIssue) {
  switch (issue.code) {
    case "too_large":
      return t("models.training.issues.too_large", {
        mb: Math.round(issue.maxBytes / 1024 / 1024),
      });
    case "too_few":
      return t("models.training.issues.too_few", { min: issue.min });
    case "too_many":
      return t("models.training.issues.too_many", { max: issue.max });
    default:
      return t(`models.training.issues.${issue.code}`, { line: issue.line });
  }
}

