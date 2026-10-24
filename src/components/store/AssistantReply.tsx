import { useTranslation } from "react-i18next";
import type { Reply } from "./reply";

/** 思考は本文の上に折りたたんで置く。本文が出るまでは開いておき、考えている様子が見えるようにする */
export function AssistantReply({ reply, streaming }: { reply: Reply; streaming: boolean }) {
  const { t } = useTranslation();
  const thinking = streaming && !reply.content;
  return (
    <>
      {reply.reasoning && (
        <details className="group mb-1.5" open={thinking || undefined}>
          <summary className="cursor-pointer list-none text-xs text-ink-mute select-none hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
            {thinking ? t("store.playground.thinking") : t("store.playground.thought")}
          </summary>
          <p className="mt-1 border-l-2 border-line pl-3 text-xs leading-5 whitespace-pre-wrap text-ink-mute">
            {reply.reasoning}
          </p>
        </details>
      )}
      {reply.content}
    </>
  );
}
