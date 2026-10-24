import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  publishModel,
  unpublishModel,
  type ModelRecord,
  type ModelVisibility,
} from "@/lib/api-client";
import { useFineTunes } from "./hooks";
import { EndpointBadge } from "./ui";

type StepState = "done" | "current" | "pending";

function Step({
  index,
  title,
  state,
  summary,
  last,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  summary?: ReactNode;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="relative flex gap-4">
      {/* 手順をつなぐ線路。終わった区間はブランドカラーで灯る */}
      {!last && (
        <span
          aria-hidden
          className={`absolute top-9 bottom-1 left-[15px] w-[3px] rounded-full ${
            state === "done" ? "rail-track-lit" : "rail-track"
          }`}
        />
      )}
      <span
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          state === "done"
            ? "bg-brand text-on-brand"
            : state === "current"
              ? "bg-paper text-brand-ink ring-2 ring-brand-ink"
              : "bg-paper text-ink-mute ring-1 ring-line-strong"
        }`}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : index}
      </span>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-8"}`}>
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {summary}
        </div>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}

/**
 * 公開までの手順。学習 → デプロイ → 料金 → 公開。
 * 公開と非公開の切り替えは組織の管理者だけができる。
 */
export function LaunchPanel({
  organizationId,
  model,
  isDirty,
  canManage,
  onOpenTab,
  onChanged,
}: {
  organizationId: string;
  model: ModelRecord;
  isDirty: boolean;
  canManage: boolean;
  onOpenTab: (tab: "training" | "settings" | "test") => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const jobs = useFineTunes(organizationId, model.id);
  const trained = (jobs.data?.items ?? []).some((job) => job.status === "succeeded");
  const training = (jobs.data?.items ?? []).some(
    (job) => job.status === "queued" || job.status === "running",
  );
  const configured = Boolean(model.endpointId);
  const published = model.status === "published";
  const priced =
    model.priceInputMicros > 0 || model.priceOutputMicros > 0 || model.pricePerRequestMicros > 0;
  const [busy, setBusy] = useState(false);

  const missingTagline = !model.tagline.trim();
  const blocked = busy || isDirty || !configured || !canManage;

  const publish = async (visibility: ModelVisibility) => {
    if (blocked || (visibility === "public" && missingTagline)) return;
    setBusy(true);
    try {
      await publishModel(organizationId, model.id, visibility);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("models.launch.publish.failed"));
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (busy || !window.confirm(t("models.launch.publish.unpublishConfirm"))) return;
    setBusy(true);
    try {
      await unpublishModel(organizationId, model.id);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("models.launch.publish.failed"));
    } finally {
      setBusy(false);
    }
  };

  const publishStep = (index: number) => (
    <Step
      index={index}
      title={t("models.launch.publish.title")}
      state={published ? "done" : configured ? "current" : "pending"}
      last
      summary={
        published && (
          <span className="text-sm text-ink-mute">
            {t(`models.launch.publish.options.${model.visibility}.description`)}
          </span>
        )
      }
    >
      {!canManage ? (
        <p className="text-sm text-ink-mute">{t("models.launch.publish.managerOnly")}</p>
      ) : published ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="console-button-secondary"
            type="button"
            disabled={blocked || (model.visibility === "private" && missingTagline)}
            onClick={() => void publish(model.visibility === "public" ? "private" : "public")}
          >
            {model.visibility === "public"
              ? t("models.launch.publish.options.private.switch")
              : t("models.launch.publish.options.public.action")}
          </button>
          <button
            className="px-2 text-sm text-ink-mute transition-colors hover:text-danger disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => void unpublish()}
          >
            {t("models.launch.publish.unpublish")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="console-button-primary"
              type="button"
              disabled={blocked || missingTagline}
              onClick={() => void publish("public")}
            >
              {t("models.launch.publish.options.public.action")}
            </button>
            <button
              className="console-button-secondary"
              type="button"
              disabled={blocked}
              onClick={() => void publish("private")}
            >
              {t("models.launch.publish.options.private.action")}
            </button>
          </div>
          {isDirty && <p className="text-sm text-signal">{t("models.launch.configure.unsaved")}</p>}
          {missingTagline && configured && (
            <p className="text-sm text-signal">
              {t("models.launch.publish.needsTagline")}{" "}
              <button
                type="button"
                className="font-semibold text-brand-ink hover:underline"
                onClick={() => onOpenTab("settings")}
              >
                {t("models.launch.openSettings")}
              </button>
            </p>
          )}
        </div>
      )}
    </Step>
  );

  return (
    <section className="console-panel p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-ink">{t("models.launch.title")}</h2>
      <ol className="mt-6">
        <Step
          index={1}
          title={t("models.launch.train.title")}
          state={trained ? "done" : "current"}
          summary={
            <span className="text-sm text-ink-mute">
              {training
                ? t("models.launch.train.running")
                : trained
                  ? t("models.launch.train.done")
                  : t("models.launch.train.todo")}
            </span>
          }
        >
          {!trained && (
            <button
              className="console-button-secondary"
              type="button"
              onClick={() => onOpenTab("training")}
            >
              {t("models.launch.train.action")}
            </button>
          )}
        </Step>
        <Step
          index={2}
          title={t("models.launch.deploy.title")}
          state={model.endpointId ? "done" : trained ? "current" : "pending"}
          summary={
            model.endpointId ? (
              <EndpointBadge status={model.endpointStatus} />
            ) : (
              <span className="text-sm text-ink-mute">
                {trained ? t("models.launch.deploy.todo") : t("models.launch.deploy.waiting")}
              </span>
            )
          }
        >
          {trained && !model.endpointId && (
            <button
              className="console-button-secondary"
              type="button"
              onClick={() => onOpenTab("training")}
            >
              {t("models.launch.deploy.action")}
            </button>
          )}
        </Step>
        <Step
          index={3}
          title={t("models.launch.price.title")}
          state={priced ? "done" : model.endpointId ? "current" : "pending"}
          summary={
            <span className="text-sm text-ink-mute">
              {priced ? t("models.launch.price.done") : t("models.launch.price.todo")}
            </span>
          }
        >
          {model.endpointId && (
            <div className="flex flex-wrap gap-2">
              <button
                className="console-button-secondary"
                type="button"
                onClick={() => onOpenTab("test")}
              >
                {t("models.launch.price.test")}
              </button>
              <button
                className="console-button-secondary"
                type="button"
                onClick={() => onOpenTab("settings")}
              >
                {t("models.launch.price.action")}
              </button>
            </div>
          )}
        </Step>
        {publishStep(4)}
      </ol>
    </section>
  );
}
