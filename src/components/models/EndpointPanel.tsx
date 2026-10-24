import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Power, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  refreshEndpoint,
  startEndpoint,
  stopEndpoint,
  undeployModel,
  type ModelRecord,
} from "@/lib/api-client";
import { useDateFormatter, useYen } from "@/components/account/hooks";
import { useBaseModels } from "./hooks";
import { EndpointBadge, Section } from "./ui";
import { useConfirm } from "@/components/ui/useConfirm";

/** 起動中・停止中は、この間隔で状態を問い合わせる */
const POLL_MS = 10_000;

/**
 * Nebius の推論エンドポイント。動いている間だけ GPU 代が組織のクレジットから引かれ、
 * 呼ばれないまま待ち時間が過ぎると止まる。止まっていても、次の呼び出しで起動する。
 */
export function EndpointPanel({
  organizationId,
  model,
  canManage,
  onChanged,
}: {
  organizationId: string;
  model: ModelRecord;
  canManage: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [confirm, confirmDialog] = useConfirm();
  const yen = useYen();
  const dateFormatter = useDateFormatter();
  const queryClient = useQueryClient();
  const baseModels = useBaseModels(organizationId);
  const [busy, setBusy] = useState(false);
  const status = model.endpointStatus;
  const transitioning = status === "deploying" || status === "starting" || status === "stopping";
  const base = baseModels.data?.items.find((option) => option.id === model.baseModelId);
  const idleMinutes = baseModels.data?.idleMinutes;

  // 起動中は Nebius に状態を問い合わせ続ける (LoRA を読み込み終えると running になる)
  useEffect(() => {
    if (!transitioning) return;
    const timer = window.setInterval(() => {
      void refreshEndpoint(organizationId, model.id)
        .then((next) => {
          if (next.endpointStatus !== status) void onChanged();
        })
        .catch((error) => console.error(error));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [model.id, onChanged, organizationId, status, transitioning]);

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(failure));
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["wallet", organizationId] });
    }
  };

  if (!model.endpointId && status !== "failed") {
    return (
      <Section title={t("models.endpoint.title")} description={t("models.endpoint.description")}>
        <p className="rounded-(--radius-control) bg-paper px-4 py-3 text-sm text-ink-mute">
          {t("models.endpoint.notDeployed")}
        </p>
      </Section>
    );
  }

  return (
    <Section
      title={t("models.endpoint.title")}
      description={t("models.endpoint.description")}
      actions={<EndpointBadge status={status} />}
    >
      {confirmDialog}
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-mute">{t("models.endpoint.baseModel")}</dt>
          <dd className="mt-1 text-ink">{base?.label ?? model.baseModelId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-mute">{t("models.endpoint.rate")}</dt>
          <dd className="num mt-1 text-ink">
            {base ? t("models.training.perHour", { amount: yen(base.serveMicrosPerHour) }) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-mute">{t("models.endpoint.lastUsed")}</dt>
          <dd className="num mt-1 text-ink">
            {model.endpointLastUsedAt
              ? dateFormatter.format(new Date(model.endpointLastUsedAt))
              : "—"}
          </dd>
        </div>
      </dl>

      <p className="text-sm leading-6 text-ink-soft">
        {t(`models.endpoint.hint.${status}`, { minutes: idleMinutes ?? "—" })}
      </p>
      {model.endpointError && (
        <p className="rounded-(--radius-control) bg-danger-tint px-3 py-2 text-xs break-words text-danger">
          {model.endpointError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "stopped" && (
          <button
            className="console-button-primary"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => startEndpoint(organizationId, model.id), "models.endpoint.startFailed")
            }
          >
            <Power className="h-4 w-4" />
            {t("models.endpoint.start")}
          </button>
        )}
        {(status === "running" || status === "starting") && (
          <button
            className="console-button-secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => stopEndpoint(organizationId, model.id), "models.endpoint.stopFailed")
            }
          >
            <PowerOff className="h-4 w-4" />
            {t("models.endpoint.stop")}
          </button>
        )}
        <button
          className="console-button-secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() => refreshEndpoint(organizationId, model.id), "models.endpoint.refreshFailed")
          }
        >
          <RefreshCw className="h-4 w-4" />
          {t("models.endpoint.refresh")}
        </button>
        {canManage && model.endpointId && (
          <button
            className="console-button-danger"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!(await confirm(t("models.endpoint.removeConfirm"), { danger: true }))) return;
              void run(() => undeployModel(organizationId, model.id), "models.endpoint.removeFailed");
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t("models.endpoint.remove")}
          </button>
        )}
      </div>
    </Section>
  );
}
