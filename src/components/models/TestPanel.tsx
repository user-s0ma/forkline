import { useTranslation } from "react-i18next";
import { Playground } from "@/components/store/Playground";
import { Section } from "./ui";

/** コンソールでモデルを試す。料金は組織のクレジットから (自組織のモデルはクリエイター価格なし) */
export function TestPanel({
  organizationId,
  slug,
  disabledReason,
}: {
  organizationId: string;
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
        <Playground slug={slug} organizationId={organizationId} />
      )}
    </Section>
  );
}
