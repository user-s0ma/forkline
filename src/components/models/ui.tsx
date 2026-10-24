import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { SignalLamp, type LampState } from "@/components/ui/SignalLamp";
import type { EndpointStatus, ModelRecord } from "@/lib/api-client";

export { Badge };

/** 公開状態のバッジ。公開中だけ brand、それ以外は neutral。 */
export function StatusBadges({
  model,
}: {
  model: Pick<ModelRecord, "status" | "visibility">;
}) {
  const { t } = useTranslation();
  if (model.status === "suspended") {
    return <Badge tone="danger">{t("models.status.suspended")}</Badge>;
  }
  if (model.status !== "published") {
    return <Badge>{t(`models.status.${model.status}`)}</Badge>;
  }
  return model.visibility === "public" ? (
    <Badge tone="brand" dot>
      {t("models.status.published")}
    </Badge>
  ) : (
    <Badge>{t("models.visibility.private")}</Badge>
  );
}

/**
 * モデルの状態を信号灯1つで表す。
 * 点滅=起動中・停止中、点灯=公開中、赤=失敗・停止処分、消灯=下書き
 */
export function ModelLamp({
  model,
}: {
  model: Pick<ModelRecord, "status" | "visibility" | "endpointStatus">;
}) {
  const { t } = useTranslation();
  let state: LampState = "off";
  let label = t(`models.status.${model.status}`);
  if (model.status === "suspended") {
    state = "fail";
  } else if (model.endpointStatus === "failed") {
    state = "fail";
    label = t("models.endpoint.status.failed");
  } else if (
    model.endpointStatus === "deploying" ||
    model.endpointStatus === "starting" ||
    model.endpointStatus === "stopping"
  ) {
    state = "blink";
    label = t(`models.endpoint.status.${model.endpointStatus}`);
  } else if (model.status === "published") {
    state = "on";
    label =
      model.visibility === "public"
        ? t("models.status.published")
        : t("models.visibility.private");
  }
  return <SignalLamp state={state} label={label} />;
}

const ENDPOINT_TONES: Record<EndpointStatus, BadgeTone> = {
  none: "neutral",
  deploying: "signal",
  starting: "signal",
  running: "brand",
  stopping: "signal",
  stopped: "neutral",
  failed: "danger",
};

export function EndpointBadge({ status }: { status: EndpointStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={ENDPOINT_TONES[status]} dot={status !== "none"}>
      {t(`models.endpoint.status.${status}`)}
    </Badge>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="console-label">{label}</span>
      {children}
      {hint && <span className="console-hint">{hint}</span>}
    </label>
  );
}

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="console-panel p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-mute">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

/** 二択の切り替え (プロトコル・実行方式など)。 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="ui-tabs w-full sm:w-fit" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-pressed={option.value === value}
          className="ui-tab sm:flex-none"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 数値入力。空欄は null として扱う。 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  placeholder,
  className = "",
}: {
  className?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      className={`console-input num ${className}`}
      type="number"
      inputMode="decimal"
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") return onChange(null);
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}
