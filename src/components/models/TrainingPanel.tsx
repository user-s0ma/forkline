import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { datasetIssueText, useBaseModels, useFineTunes } from "./hooks";
import { FileUp, Play, Rocket, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  cancelFineTune,
  datasetIssuesOf,
  deployModel,
  isFineTuneActive,
  startFineTune,
  type FineTuneRecord,
  type FineTuneStatus,
  type ModelRecord,
} from "@/lib/api-client";
import {
  computeCostMicros,
  estimateTrainingSeconds,
  trainingHoldMicros,
} from "@/lib/billing/compute";
import {
  checkDataset,
  DATASET_MAX_BYTES,
  DEFAULT_HYPERPARAMETERS,
  LORA_RANKS,
  type DatasetCheck,
  type DatasetIssue,
} from "@/lib/models/dataset";
import { formatBytes, formatDuration } from "@/lib/util/format";
import { ConsoleSelect } from "@/components/ui/ConsoleSelect";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useDateFormatter, useYen } from "@/components/account/hooks";
import { HELD_OUT_RATIO, pickHeldOut, splitHeldOut } from "@/lib/nemotron/dataset-builder";
import { datasetLines } from "@/lib/models/dataset";
import { DatasetBuilder, type BuiltDataset } from "./DatasetBuilder";
import { Field, NumberInput, Section, Segmented } from "./ui";
import { useConfirm } from "@/components/ui/useConfirm";


const STATUS_TONES: Record<FineTuneStatus, BadgeTone> = {
  queued: "signal",
  running: "signal",
  succeeded: "brand",
  failed: "danger",
  canceled: "neutral",
};

export function FineTuneBadge({ status }: { status: FineTuneStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {t(`models.training.status.${status}`)}
    </Badge>
  );
}

type Dataset = {
  name: string;
  text: string;
  check: DatasetCheck;
  /** Nemotron で作ったとき: 評価用に取っておく例と、作者が書いた役割 */
  built?: { evalJsonl: string | null; evalCount: number; role: string };
};

type DatasetMode = "upload" | "builder";

/** 選んだファイルから評価用に取っておく例を分ける (学習にはその残りを使う) */
function splitUpload(text: string) {
  const { train, heldOut } = splitHeldOut(datasetLines(text), { seed: 1 });
  return { trainJsonl: train.join("\n"), evalJsonl: heldOut.length ? heldOut.join("\n") : null };
}

/**
 * Nemotron の LoRA 学習。ベースモデルと学習データ (chat 形式の JSONL) を選び、
 * 見積もりを見てから始める。終わった学習はここからデプロイする。
 */
export function TrainingPanel({
  model,
  onChanged,
}: {
  model: ModelRecord;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [confirm, confirmDialog] = useConfirm();
  const yen = useYen();
  const queryClient = useQueryClient();
  const baseModels = useBaseModels();
  const jobs = useFineTunes(model.id);
  const items = jobs.data?.items ?? [];
  const active = items.find(isFineTuneActive);

  const [baseModelId, setBaseModelId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [epochs, setEpochs] = useState<number | null>(DEFAULT_HYPERPARAMETERS.epochs);
  const [learningRate, setLearningRate] = useState<number | null>(
    DEFAULT_HYPERPARAMETERS.learningRate,
  );
  const [loraRank, setLoraRank] = useState<number>(DEFAULT_HYPERPARAMETERS.loraRank);
  const [loraAlpha, setLoraAlpha] = useState<number | null>(DEFAULT_HYPERPARAMETERS.loraAlpha);
  const [serverIssues, setServerIssues] = useState<DatasetIssue[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<DatasetMode>("upload");
  const [holdOut, setHoldOut] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const options = baseModels.data?.items ?? [];
  const selected =
    options.find((option) => option.id === baseModelId) ??
    options.find((option) => option.id === model.baseModelId) ??
    options[0];

  const estimate = useMemo(() => {
    if (!selected || !dataset?.check.ok) return null;
    const seconds = estimateTrainingSeconds({
      datasetBytes: dataset.check.bytes,
      epochs: epochs ?? 1,
    });
    const micros = computeCostMicros(selected.trainMicrosPerHour, seconds);
    return { seconds, micros, hold: trainingHoldMicros(micros) };
  }, [dataset, epochs, selected]);

  const hyperparametersValid =
    epochs !== null &&
    epochs >= 1 &&
    epochs <= 10 &&
    learningRate !== null &&
    learningRate > 0 &&
    learningRate <= 0.01 &&
    loraAlpha !== null &&
    loraAlpha >= 1 &&
    loraAlpha <= 256;
  const canStart =
    Boolean(selected && dataset?.check.ok && hyperparametersValid) && !active && !busy;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["fine-tunes", model.id] });
    await queryClient.invalidateQueries({ queryKey: ["wallet"] });
  };

  const pickFile = async (file: File | undefined) => {
    setServerIssues([]);
    if (!file) return;
    if (file.size > DATASET_MAX_BYTES) {
      setDataset({
        name: file.name,
        text: "",
        check: {
          ok: false,
          bytes: file.size,
          examples: 0,
          issues: [{ code: "too_large", maxBytes: DATASET_MAX_BYTES }],
        },
      });
      return;
    }
    const text = await file.text();
    setDataset({ name: file.name, text, check: checkDataset(text) });
  };

  const start = async () => {
    if (!canStart || !selected || !dataset || epochs === null || learningRate === null || loraAlpha === null) {
      return;
    }
    setBusy("start");
    setServerIssues([]);
    try {
      const split = dataset.built
        ? { trainJsonl: dataset.text, evalJsonl: dataset.built.evalJsonl }
        : holdOut
          ? splitUpload(dataset.text)
          : { trainJsonl: dataset.text, evalJsonl: null };
      await startFineTune(model.id, {
        baseModelId: selected.id,
        datasetName: dataset.name,
        jsonl: split.trainJsonl,
        evalJsonl: split.evalJsonl,
        datasetSource: dataset.built ? "builder" : "upload",
        datasetRole: dataset.built?.role ?? null,
        hyperparameters: { epochs, learningRate, loraRank, loraAlpha },
      });
      setDataset(null);
      if (fileInput.current) fileInput.current.value = "";
      toast.success(t("models.training.started"));
    } catch (error) {
      setServerIssues(datasetIssuesOf(error));
      toast.error(error instanceof Error ? error.message : t("models.training.startFailed"));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const cancel = async (job: FineTuneRecord) => {
    if (!(await confirm(t("models.training.cancelConfirm"), { danger: true }))) return;
    setBusy(job.id);
    try {
      await cancelFineTune(job.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("models.training.cancelFailed"));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const deploy = async (job: FineTuneRecord) => {
    if (model.endpointId && !(await confirm(t("models.endpoint.redeployConfirm")))) return;
    setBusy(job.id);
    try {
      await deployModel(model.id, job.id);
      toast.success(t("models.endpoint.deployStarted"));
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("models.endpoint.deployFailed"));
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  };

  const issues = dataset?.check.issues.length ? dataset.check.issues : serverIssues;
  const uploadHeldOut =
    dataset && !dataset.built && dataset.check.ok && holdOut
      ? pickHeldOut(dataset.check.examples).size
      : 0;

  const useBuilt = (built: BuiltDataset) => {
    setServerIssues([]);
    setDataset({
      name: "nemotron-dataset.jsonl",
      text: built.trainJsonl,
      check: checkDataset(built.trainJsonl),
      built: { evalJsonl: built.evalJsonl, evalCount: built.evalCount, role: built.role },
    });
    setMode("upload");
    toast.success(t("models.builder.applied", { train: built.trainCount, eval: built.evalCount }));
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      <Section
        title={t("models.training.title")}
        description={t("models.training.description")}
      >
        {active ? (
          <ActiveJob
            job={active}
            label={options.find((option) => option.id === active.baseModelId)?.label}
            busy={busy === active.id}
            onCancel={() => void cancel(active)}
          />
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("models.training.baseModel")}>
                <ConsoleSelect
                  value={selected?.id ?? ""}
                  ariaLabel={t("models.training.baseModel")}
                  placeholder={t("common.loading")}
                  options={options.map((option) => ({
                    value: option.id,
                    label: option.label,
                  }))}
                  onChange={(value) => setBaseModelId(value)}
                />
              </Field>
              {selected && (
                <dl className="grid grid-cols-2 gap-3 self-end text-xs">
                  <div>
                    <dt className="text-ink-mute">{t("models.training.trainRate")}</dt>
                    <dd className="num mt-0.5 font-semibold text-ink">
                      {t("models.training.perHour", { amount: yen(selected.trainMicrosPerHour) })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-mute">{t("models.training.serveRate")}</dt>
                    <dd className="num mt-0.5 font-semibold text-ink">
                      {t("models.training.perHour", { amount: yen(selected.serveMicrosPerHour) })}
                    </dd>
                  </div>
                </dl>
              )}
            </div>

            <Segmented
              value={mode}
              ariaLabel={t("models.training.datasetModeAria")}
              options={[
                { value: "upload", label: t("models.training.datasetModes.upload") },
                { value: "builder", label: t("models.training.datasetModes.builder") },
              ]}
              onChange={setMode}
            />

            {/* 作りかけの例を残すよう、切り替えても消さずに隠すだけにする */}
            <div hidden={mode !== "builder"}>
              <DatasetBuilder modelId={model.id} onUse={useBuilt} />
            </div>

            <div hidden={mode !== "upload"}>
              <span className="console-label">{t("models.training.dataset")}</span>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-control) border border-dashed border-line-strong bg-paper px-4 py-6 text-center text-sm text-ink-soft hover:border-brand-ink">
                <FileUp className="h-5 w-5 text-ink-mute" aria-hidden />
                {dataset?.built ? (
                  <span>
                    <span className="font-semibold text-ink">{t("models.training.builtDataset")}</span>{" "}
                    <span className="num text-ink-mute">
                      {t("models.training.builtSummary", {
                        train: dataset.check.examples.toLocaleString(),
                        eval: dataset.built.evalCount.toLocaleString(),
                      })}
                    </span>
                  </span>
                ) : dataset ? (
                  <span>
                    <span className="font-semibold text-ink">{dataset.name}</span>{" "}
                    <span className="num text-ink-mute">
                      {t("models.training.datasetSummary", {
                        size: formatBytes(dataset.check.bytes),
                        examples: dataset.check.examples.toLocaleString(),
                      })}
                    </span>
                  </span>
                ) : (
                  <span>{t("models.training.datasetPick")}</span>
                )}
                <input
                  ref={fileInput}
                  className="sr-only"
                  type="file"
                  accept=".jsonl,application/jsonl,application/x-ndjson,text/plain"
                  onChange={(event) => void pickFile(event.target.files?.[0])}
                />
              </label>
              <span className="console-hint">
                {t("models.training.datasetHint", {
                  mb: Math.round(DATASET_MAX_BYTES / 1024 / 1024),
                })}
              </span>
              <pre className="mt-2 overflow-x-auto rounded-(--radius-control) bg-paper px-3 py-2 font-mono text-[11px] leading-5 text-ink-soft">
                {'{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}'}
              </pre>
              {!dataset?.built && (
                <label className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
                  <input
                    type="checkbox"
                    className="mt-1 h-3.5 w-3.5 accent-brand"
                    checked={holdOut}
                    onChange={(event) => setHoldOut(event.target.checked)}
                  />
                  <span>
                    {t("models.training.holdOut", { percent: Math.round(HELD_OUT_RATIO * 100) })}
                    {uploadHeldOut > 0 && (
                      <span className="num ml-1 text-ink-mute">
                        {t("models.training.holdOutCount", { count: uploadHeldOut })}
                      </span>
                    )}
                  </span>
                </label>
              )}
              {issues.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-(--radius-control) bg-danger-tint px-3 py-2 text-xs text-danger" role="alert">
                  {issues.map((issue, index) => (
                    <li key={index}>{datasetIssueText(t, issue)}</li>
                  ))}
                </ul>
              )}
            </div>

            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold text-ink-soft select-none hover:text-ink">
                {t("models.training.hyperparameters")}
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-4">
                <Field label={t("models.training.epochs")}>
                  <NumberInput value={epochs} min={1} max={10} step={1} onChange={setEpochs} />
                </Field>
                <Field label={t("models.training.learningRate")}>
                  <NumberInput
                    value={learningRate}
                    min={0.000001}
                    max={0.01}
                    step="any"
                    onChange={setLearningRate}
                  />
                </Field>
                <Field label={t("models.training.loraRank")}>
                  <ConsoleSelect
                    value={String(loraRank)}
                    ariaLabel={t("models.training.loraRank")}
                    options={LORA_RANKS.map((rank) => ({ value: String(rank), label: String(rank) }))}
                    onChange={(value) => setLoraRank(Number(value))}
                  />
                </Field>
                <Field label={t("models.training.loraAlpha")}>
                  <NumberInput value={loraAlpha} min={1} max={256} step={1} onChange={setLoraAlpha} />
                </Field>
              </div>
            </details>

            <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
              <div className="text-sm">
                {estimate ? (
                  <>
                    <p className="text-ink">
                      {t("models.training.estimate", {
                        duration: formatDuration(t, estimate.seconds),
                        amount: yen(estimate.micros),
                      })}
                    </p>
                    <p className="mt-1 text-xs text-ink-mute">
                      {t("models.training.holdNote", { amount: yen(estimate.hold) })}
                    </p>
                  </>
                ) : (
                  <p className="text-ink-mute">{t("models.training.estimatePending")}</p>
                )}
              </div>
              <button
                className="console-button-primary"
                type="button"
                disabled={!canStart}
                onClick={() => void start()}
              >
                <Play className="h-4 w-4" />
                {busy === "start" ? t("models.training.starting") : t("models.training.start")}
              </button>
            </div>
          </>
        )}
      </Section>

      <JobHistory
        items={items}
        isPending={jobs.isPending}
        model={model}
        labels={Object.fromEntries(options.map((option) => [option.id, option.label]))}
        busy={busy}
        onDeploy={(job) => void deploy(job)}
        onCancel={(job) => void cancel(job)}
      />
    </div>
  );
}

function ActiveJob({
  job,
  label,
  busy,
  onCancel,
}: {
  job: FineTuneRecord;
  label?: string;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FineTuneBadge status={job.status} />
          <span className="text-sm font-semibold text-ink">{label ?? job.baseModelId}</span>
        </div>
        <button className="console-button-danger" type="button" disabled={busy} onClick={onCancel}>
          <X className="h-4 w-4" />
          {t("models.training.cancel")}
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full w-1/3 animate-[rail_1.6s_ease-in-out_infinite] rounded-full bg-brand-ink" />
      </div>
      <p className="text-sm text-ink-soft">
        {t(`models.training.activeHint.${job.status}`)}
      </p>
      <p className="num text-xs text-ink-mute">
        {t("models.training.activeMeta", {
          dataset: job.datasetName,
          examples: job.datasetExamples.toLocaleString(),
          estimate: yen(job.estimatedMicros),
          hold: yen(job.heldMicros),
        })}
      </p>
    </div>
  );
}

function JobHistory({
  items,
  isPending,
  model,
  labels,
  busy,
  onDeploy,
  onCancel,
}: {
  items: FineTuneRecord[];
  isPending: boolean;
  model: ModelRecord;
  labels: Record<string, string>;
  busy: string | null;
  onDeploy: (job: FineTuneRecord) => void;
  onCancel: (job: FineTuneRecord) => void;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const dateFormatter = useDateFormatter();
  if (isPending || items.length === 0) return null;
  return (
    <section className="console-panel overflow-x-auto">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">{t("models.training.historyTitle")}</h2>
      </div>
      <table className="console-table min-w-[44rem]">
        <thead>
          <tr>
            <th>{t("models.training.columns.status")}</th>
            <th>{t("models.training.columns.dataset")}</th>
            <th>{t("models.training.columns.startedAt")}</th>
            <th className="text-right">{t("models.training.columns.cost")}</th>
            <th className="w-40" />
          </tr>
        </thead>
        <tbody>
          {items.map((job) => {
            const deployed = model.fineTuneId === job.id && Boolean(model.endpointId);
            return (
              <tr key={job.id}>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <FineTuneBadge status={job.status} />
                    {deployed && <Badge tone="brand">{t("models.training.deployed")}</Badge>}
                  </div>
                </td>
                <td className="min-w-0">
                  <p className="truncate text-ink">{job.datasetName}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-mute">
                    {labels[job.baseModelId] ?? job.baseModelId} ·{" "}
                    {t("models.training.examples", { count: job.datasetExamples })}
                    {job.evalExamples > 0 &&
                      ` · ${t("models.training.evalExamples", { count: job.evalExamples })}`}
                    {job.datasetSource === "builder" && ` · ${t("models.training.fromBuilder")}`}
                  </p>
                  {job.error && (
                    <p className="mt-1 text-xs break-words text-danger">{job.error}</p>
                  )}
                </td>
                <td className="num text-ink-mute">
                  {dateFormatter.format(new Date(job.startedAt ?? job.createdAt))}
                </td>
                <td className="num text-right">
                  {isFineTuneActive(job)
                    ? t("models.training.estimated", { amount: yen(job.estimatedMicros) })
                    : yen(job.costMicros)}
                </td>
                <td className="text-right">
                  {job.status === "succeeded" && !deployed && (
                    <button
                      className="console-button-primary"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onDeploy(job)}
                    >
                      <Rocket className="h-4 w-4" />
                      {t("models.endpoint.deploy")}
                    </button>
                  )}
                  {isFineTuneActive(job) && (
                    <button
                      className="console-button-danger"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onCancel(job)}
                    >
                      {t("models.training.cancel")}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
