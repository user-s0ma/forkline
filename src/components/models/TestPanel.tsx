import { useTranslation } from "react-i18next";
import { Playground } from "@/components/store/Playground";
import { Section } from "./ui";

/** コンソールでモデルを試す。料金は自分のクレジットから (自分のモデルはクリエイター価格なし) */
export function TestPanel({
  slug,
  disabledReason,
}: {
  slug: string;
  disabledReason: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t("models.test.title")} description={t("models.test.description")}>
      {disabledReason ? (
        <p className="rounded-(--radius-control) bg-signal-tint px-4 py-3 text-sm text-signal">
          {disabledReason}
        </p>
      ) : (
        <Playground slug={slug} />
      )}
    </Section>
  );
}
