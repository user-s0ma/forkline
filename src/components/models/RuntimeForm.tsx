import { useTranslation } from "react-i18next";
import type { ModelUpdateInput } from "@/lib/api-client";
import { Field, NumberInput, Section } from "./ui";

/** 実行の設定。いまは返答の長さの上限だけ */
export function RuntimeForm({
  id,
  config,
  onChange,
}: {
  id?: string;
  config: ModelUpdateInput["config"];
  onChange: (config: ModelUpdateInput["config"]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div id={id} className="scroll-mt-6">
      <Section title={t("models.runtimeForm.title")}>
        <Field
          label={t("models.runtimeForm.maxOutputTokens")}
          hint={t("models.runtimeForm.maxOutputTokensHint")}
          className="max-w-xs"
        >
          <NumberInput
            value={config.maxOutputTokens}
            min={16}
            max={32_000}
            step={1}
            onChange={(next) => onChange({ ...config, maxOutputTokens: next ?? 2048 })}
          />
        </Field>
      </Section>
    </div>
  );
}
