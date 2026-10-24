import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { useCopy } from "@/components/store/use-copy";
import { Section } from "./ui";

const API_BASE = "https://forkline.ai/v1";

function apiSnippet(slug: string) {
  return `curl ${API_BASE}/chat/completions \\
  -H "Authorization: Bearer $FORKLINE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${slug}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
}

export function ApiSnippet({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const code = apiSnippet(slug);
  const { copied, copy } = useCopy();
  return (
    <Section
      title={t("models.snippet.title")}
      actions={
        <button
          className="console-button-secondary"
          type="button"
          onClick={() => void copy(code)}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      }
    >
      <pre className="overflow-x-auto rounded-(--radius-control) border border-line bg-code p-4 font-mono text-xs leading-5 text-code-ink">
        {code}
      </pre>
    </Section>
  );
}
