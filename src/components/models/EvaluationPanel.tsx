import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Play, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ApiError,
  draftModelCard,
  getEvaluation,
  listEvaluations,
  startEvaluation,
  stepEvaluation,
  type EvalItemRecord,
  type EvalRunRecord,
  type EvalRunStatus,
  type ModelRecord,
} from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { formatPValue, type EvalSummary } from "@/lib/nemotron/evaluation";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useDateFormatter, useYen } from "@/components/account/hooks";
import { Field, Section } from "./ui";

export type CardDraft = { tagline: string; description: string; tags: string[] };

const RUN_TONES: Record<EvalRunStatus, BadgeTone> = {
  running: "signal",
  succeeded: "brand",
  failed: "danger",
  canceled: "neutral",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 微調整したモデルの評価とモデルカードの下書き。
 * 評価は画面が step を繰り返し呼んで少しずつ進める (タブを離れたら止まり、戻ると続きから進む)。
 */
export function EvaluationPanel({
  model,
  onApplyCard,
}: {
  model: ModelRecord;
  onApplyCard: (draft: CardDraft) => void;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ["evaluations", model.id],
    queryFn: () => listEvaluations(model.id),
  });
  const runs = overview.data?.items ?? [];
  const latest = runs[0] as EvalRunRecord | undefined;
  const detail = useQuery({
    queryKey: ["evaluation", latest?.id],
    queryFn: () => getEvaluation(latest!.id),
    enabled: Boolean(latest),
  });
  const [stepping, setStepping] = useState(false);
  const [warming, setWarming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  /** いま動いている step の繰り返し。止めるときは null にする (古い繰り返しは自分の印と違うので抜ける) */
  const loopRef = useRef<{ runId: string; token: object } | null>(null);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["evaluations", model.id] });
    await queryClient.invalidateQueries({ queryKey: ["evaluation"] });
    await queryClient.invalidateQueries({ queryKey: ["wallet"] });
  }, [model.id, queryClient]);

  // 進行中の評価があれば、終わるまで step を呼び続ける
  const runLoop = useCallback(
    async (runId: string) => {
      if (loopRef.current?.runId === runId) return;
      const token = {};
      loopRef.current = { runId, token };
      const alive = () => loopRef.current?.token === token;
      setStepping(true);
      setPaused(false);
      try {
        while (alive()) {
          let response;
          try {
            response = await stepEvaluation(runId);
          } catch (error) {
            if (error instanceof ApiError && error.status === 402) {
              setPaused(true);
              toast.error(error.message);
            } else {
              toast.error(error instanceof Error ? error.message : t("models.evaluation.stepFailed"));
              setPaused(true);
            }
            break;
          }
          await queryClient.invalidateQueries({ queryKey: ["evaluation", runId] });
          if (response.state === "done") break;
          if (response.state === "warming_up") {
            setWarming(true);
            await sleep(Math.max(5, response.retryAfter) * 1000);
            continue;
          }
          setWarming(false);
        }
      } finally {
        if (alive()) loopRef.current = null;
        setStepping(false);
        setWarming(false);
        await refresh();
      }
    },
    [queryClient, refresh, t],
  );

  useEffect(() => {
    if (latest?.status === "running" && !paused) void runLoop(latest.id);
  }, [latest?.id, latest?.status, paused, runLoop]);

  // 画面を離れたら止める (次に開いたときに続きから進める)
  useEffect(
    () => () => {
      loopRef.current = null;
    },
    [],
  );

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const run = await startEvaluation(model.id);
      loopRef.current = null;
      setPaused(false);
      await refresh();
      void runLoop(run.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("models.evaluation.startFailed"));
    } finally {
      setStarting(false);
    }
  };

  const info = overview.data;
  const running = latest?.status === "running";
  const doneItems = (detail.data?.items ?? []).filter(
    (item) => item.status === "done" || item.status === "failed",
  ).length;

  return (
    <div className="space-y-6">
      <Section
        title={t("models.evaluation.title")}
        description={t("models.evaluation.description")}
        actions={
          <button
            className="console-button-primary"
            type="button"
            disabled={!info || Boolean(info.blocker) || running || starting}
            onClick={() => void start()}
          >
            <Play className="h-4 w-4" />
            {latest ? t("models.evaluation.rerun") : t("models.evaluation.run")}
          </button>
        }
      >
        {info?.blocker ? (
          <p className="rounded-(--radius-control) bg-paper px-3 py-2.5 text-sm text-ink-soft">
            {t(`models.evaluation.blockers.${info.blocker}`)}
          </p>
        ) : info ? (
          <p className="num text-sm text-ink-soft">
            {t("models.evaluation.plan", {
              questions: info.questions,
              baseline: info.baselineModel,
              amount: yen(info.estimateMicros),
            })}
          </p>
        ) : null}

        {latest && running && (
          <div className="space-y-2 rounded-(--radius-control) border border-line bg-paper p-4" role="status">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone="signal" dot>
                {warming ? t("models.evaluation.warming") : t("models.evaluation.status.running")}
              </Badge>
              <span className="num text-xs text-ink-mute">
                {t("models.evaluation.progress", { done: doneItems, total: latest.itemCount })}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand-ink transition-[width]"
                style={{ width: `${latest.itemCount ? (doneItems / latest.itemCount) * 100 : 0}%` }}
              />
            </div>
            {paused && !stepping && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-xs text-ink-mute">{t("models.evaluation.paused")}</p>
                <button
                  className="console-button-secondary"
                  type="button"
                  onClick={() => {
                    setPaused(false);
                    void runLoop(latest.id);
                  }}
                >
                  {t("models.evaluation.resume")}
                </button>
              </div>
            )}
          </div>
        )}

        {latest && !running && latest.status !== "succeeded" && (
          <p className="text-sm text-danger">
            {t(`models.evaluation.status.${latest.status}`)}
            {latest.error ? `: ${latest.error}` : ""}
          </p>
        )}

        {latest?.summary && latest.status === "succeeded" && (
          <EvalSummaryView run={latest} summary={latest.summary} />
        )}
      </Section>

      {detail.data && detail.data.items.some((item) => item.status === "done" || item.status === "failed") && (
        <EvalItemsTable items={detail.data.items} />
      )}

      <ModelCardSection model={model} onApply={onApplyCard} />

      {runs.length > 1 && <RunHistory runs={runs.slice(1)} />}
    </div>
  );
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** 平均点・勝率・符号検定・信頼区間と、その読み方 */
export function EvalSummaryView({ run, summary }: { run: EvalRunRecord; summary: EvalSummary }) {
  const { t } = useTranslation();
  const yen = useYen();
  const interval = summary.interval
    ? `${summary.interval[0] >= 0 ? "+" : ""}${summary.interval[0]} 〜 ${summary.interval[1] >= 0 ? "+" : ""}${summary.interval[1]}`
    : "—";
  const stats = [
    { label: t("models.evaluation.fineTunedMean"), value: `${summary.fineTunedMean.toFixed(2)} / 5` },
    { label: t("models.evaluation.baseMean"), value: `${summary.baseMean.toFixed(2)} / 5` },
    { label: t("models.evaluation.winRate"), value: pct(summary.winRate) },
    {
      label: t("models.evaluation.record"),
      value: t("models.evaluation.recordValue", {
        wins: summary.wins,
        ties: summary.ties,
        losses: summary.losses,
      }),
    },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-(--radius-control) bg-paper px-3 py-2.5">
            <dt className="text-xs text-ink-mute">{stat.label}</dt>
            <dd className="num mt-0.5 text-lg font-semibold text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm leading-6 text-ink">
        {t(`models.evaluation.verdicts.${summary.verdict}`, {
          n: summary.n,
          p: formatPValue(summary.signTestP),
        })}
      </p>
      <p className="num text-xs leading-5 text-ink-mute">
        {t("models.evaluation.footnote", {
          n: summary.n,
          failed: summary.failed,
          p: formatPValue(summary.signTestP),
          interval,
          baseline: run.baselineModel,
          judge: run.judgeModel,
          amount: yen(run.costMicros),
        })}
      </p>
    </div>
  );
}

function lastUserMessage(item: EvalItemRecord) {
  return [...item.prompt].reverse().find((message) => message.role === "user")?.content ?? "";
}

function EvalItemsTable({ items }: { items: EvalItemRecord[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="console-panel overflow-x-auto">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">{t("models.evaluation.itemsTitle")}</h2>
      </div>
      <table className="console-table min-w-[40rem]">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>{t("models.evaluation.columns.question")}</th>
            <th className="w-24 text-right">{t("models.evaluation.columns.fineTuned")}</th>
            <th className="w-24 text-right">{t("models.evaluation.columns.base")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const expanded = open === item.id;
            return (
              <tr key={item.id} className="align-top">
                <td className="num text-ink-mute">{item.position + 1}</td>
                <td className="min-w-0">
                  <button
                    type="button"
                    className="block w-full text-left text-ink hover:text-brand-ink"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : item.id)}
                  >
                    <span className="line-clamp-2 break-words">{lastUserMessage(item)}</span>
                  </button>
                  {item.status === "failed" && (
                    <p className="mt-1 text-xs text-danger">
                      {item.error === "judge_output_invalid"
                        ? t("models.evaluation.judgeInvalid")
                        : t("models.evaluation.itemFailed")}
                    </p>
                  )}
                  {(item.status === "pending" || item.status === "running") && (
                    <p className="mt-1 text-xs text-ink-mute">{t("models.evaluation.itemPending")}</p>
                  )}
                  {expanded && (
                    <div className="mt-3 space-y-3 text-xs leading-5">
                      <Answer label={t("models.evaluation.reference")} text={item.reference} />
                      <Answer
                        label={t("models.evaluation.columns.fineTuned")}
                        text={item.fineTunedAnswer}
                        reason={item.fineTunedReason}
                      />
                      <Answer
                        label={t("models.evaluation.columns.base")}
                        text={item.baseAnswer}
                        reason={item.baseReason}
                      />
                    </div>
                  )}
                </td>
                <td className="num text-right font-semibold">{item.fineTunedScore ?? "—"}</td>
                <td className="num text-right">{item.baseScore ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Answer({ label, text, reason }: { label: string; text: string | null; reason?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-(--radius-control) bg-paper px-3 py-2">
      <p className="font-semibold text-ink-soft">{label}</p>
      <p className="mt-1 break-words whitespace-pre-wrap text-ink">{text ?? "—"}</p>
      {reason && (
        <p className="mt-1.5 text-ink-mute">
          {t("models.evaluation.reason")}: {reason}
        </p>
      )}
    </div>
  );
}

function RunHistory({ runs }: { runs: EvalRunRecord[] }) {
  const { t } = useTranslation();
  const dateFormatter = useDateFormatter();
  return (
    <section className="console-panel overflow-x-auto">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">{t("models.evaluation.historyTitle")}</h2>
      </div>
      <table className="console-table min-w-[36rem]">
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Badge tone={RUN_TONES[run.status]}>{t(`models.evaluation.status.${run.status}`)}</Badge>
              </td>
              <td className="num text-ink-mute">{dateFormatter.format(new Date(run.createdAt))}</td>
              <td className="num text-right">
                {run.summary
                  ? t("models.evaluation.historyScore", {
                      fineTuned: run.summary.fineTunedMean.toFixed(2),
                      base: run.summary.baseMean.toFixed(2),
                      n: run.summary.n,
                    })
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Nemotron にモデルカードの下書きを作らせ、直してから設定の画面に入れる */
function ModelCardSection({
  model,
  onApply,
}: {
  model: ModelRecord;
  onApply: (draft: CardDraft) => void;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [cost, setCost] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const generate = async () => {
    setBusy(true);
    try {
      const result = await draftModelCard(model.id, locale === "ja" ? "ja" : "en");
      setDraft({ tagline: result.tagline, description: result.description, tags: result.tags });
      setCost(result.costMicros);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("models.card.failed"));
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().slice(0, 32);
    setTagInput("");
    if (!draft || !tag || draft.tags.includes(tag) || draft.tags.length >= 10) return;
    setDraft({ ...draft, tags: [...draft.tags, tag] });
  };

  return (
    <Section
      title={t("models.card.title")}
      description={t("models.card.description")}
      actions={
        <button
          className="console-button-secondary"
          type="button"
          disabled={busy || !model.fineTuneId}
          onClick={() => void generate()}
        >
          {busy ? <FlaskConical className="h-4 w-4 animate-pulse" /> : <Sparkles className="h-4 w-4" />}
          {busy ? t("models.card.drafting") : draft ? t("models.card.redraft") : t("models.card.draft")}
        </button>
      }
    >
      {!model.fineTuneId && <p className="text-sm text-ink-mute">{t("models.card.needsDeploy")}</p>}
      {draft && (
        <div className="space-y-4">
          <Field label={t("models.general.tagline")}>
            <input
              className="console-input"
              value={draft.tagline}
              maxLength={160}
              onChange={(event) => setDraft({ ...draft, tagline: event.target.value })}
            />
          </Field>
          <Field label={t("models.general.description")}>
            <textarea
              className="console-input h-auto min-h-40 resize-y py-2 leading-6"
              value={draft.description}
              maxLength={50_000}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>
          <div>
            <span className="console-label">{t("models.general.tags")}</span>
            <input
              className="console-input"
              value={tagInput}
              maxLength={32}
              placeholder={t("models.general.tagsPlaceholder")}
              aria-label={t("models.general.tags")}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
            {draft.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pr-1 pl-2.5 text-xs text-ink ring-1 ring-line ring-inset"
                  >
                    {tag}
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-ink-mute hover:bg-line hover:text-ink"
                      aria-label={t("models.general.removeTag", { tag })}
                      onClick={() => setDraft({ ...draft, tags: draft.tags.filter((item) => item !== tag) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="num text-xs text-ink-mute">{t("models.card.cost", { amount: yen(cost) })}</p>
            <button
              className="console-button-primary"
              type="button"
              disabled={!draft.tagline.trim()}
              onClick={() => onApply({ ...draft, tagline: draft.tagline.trim() })}
            >
              {t("models.card.apply")}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}
