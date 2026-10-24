import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function useCopy() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("store.api.copyFailed"));
    }
  };
  return { copied, copy };
}
