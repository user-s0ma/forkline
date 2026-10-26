import { useEffect, useMemo } from "react";
import { useOutletContext } from "react-router";
import { toast } from "sonner";
import { LOCALE_TAG } from "@/lib/i18n";
import { formatYen } from "@/lib/billing/pricing";
import type { AppLayoutContext } from "@/app/routes/app/_layout";

/** コンソールのページ共通コンテキスト (ログイン中ユーザーとモバイルメニュー) を返す。 */
export function useAccountPage() {
  return useOutletContext<AppLayoutContext>();
}

export function useYen() {
  const tag = LOCALE_TAG;
  return useMemo(() => (micros: number) => formatYen(micros, tag), [tag]);
}

export function useDateFormatter(
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
) {
  const key = JSON.stringify(options);
  return useMemo(
    () => new Intl.DateTimeFormat(LOCALE_TAG, JSON.parse(key)),
    [key],
  );
}

export function useErrorToast(error: unknown, fallback: string) {
  useEffect(() => {
    if (!error) return;
    console.error(error);
    toast.error(error instanceof Error ? error.message : fallback);
  }, [error, fallback]);
}
