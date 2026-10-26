import { useTranslation } from "react-i18next";
import recording from "./demo-conversation.json";

/**
 * 審査員向けのデモアカウントで、モデルの画面の上に出す案内。
 * GPU を起こさなくても中身が分かるよう、このモデルと実際に話した会話 (記録したもの) を見せる
 */
export function DemoGuide({ onOpenTab }: { onOpenTab: (tab: "evaluation") => void }) {
  const { t } = useTranslation();
  return (
    <section className="console-panel space-y-4 p-5 sm:p-6">
      <p className="text-sm text-ink-soft">{t("models.demoGuide.body", { date: recording.recordedOn })}</p>

      <ol className="space-y-3 text-sm">
        {recording.turns.map((turn, index) => (
          <li key={index} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[85%] rounded-xl bg-brand-tint px-3 py-2 text-ink">{turn.user}</p>
            <p className="w-fit max-w-[85%] rounded-xl border border-line px-3 py-2 leading-6 whitespace-pre-wrap text-ink">
              {turn.assistant}
            </p>
          </li>
        ))}
      </ol>

      <button type="button" className="text-sm font-semibold text-brand-ink hover:underline" onClick={() => onOpenTab("evaluation")}>
        {t("models.demoGuide.toEvaluation")}
      </button>
    </section>
  );
}
