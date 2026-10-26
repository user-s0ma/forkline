import { useTranslation } from "react-i18next";
import recording from "./demo-conversation.json";

/**
 * 審査員向けのデモアカウントで、モデルの画面の上に出す案内。
 * GPU を起こさなくても中身が分かるよう、このモデルと実際に話した会話 (記録したもの) を見せる
 */
export function DemoGuide({ onOpenTab }: { onOpenTab: (tab: "training" | "evaluation") => void }) {
  const { t } = useTranslation();
  return (
    <section className="ui-card space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">{t("models.demoGuide.title")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft">{t("models.demoGuide.body", { date: recording.recordedOn })}</p>
      </div>

      <div>
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
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => onOpenTab("evaluation")}>
          {t("models.demoGuide.toEvaluation")}
        </button>
        <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => onOpenTab("training")}>
          {t("models.demoGuide.toDeploy")}
        </button>
      </div>
      <p className="text-xs leading-5 text-ink-mute">{t("models.demoGuide.deployNote")}</p>
    </section>
  );
}
