import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Sparkles, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, extractDatasetFacts, paraphraseDatasetFacts } from "@/lib/api-client";
import { tokenFactoryHoldMicros } from "@/lib/billing/compute";
import { DATASET_MIN_EXAMPLES } from "@/lib/models/dataset";
import {
  BUILDER_MATERIAL_MAX_CHARS,
  BUILDER_ROLE_MAX_CHARS,
  BUILDER_PARAPHRASES,
  chunkMaterial,
  estimateBuild,
  estimateParaphrase,
  examplesToJsonl,
  runBuild,
  type BuiltExample,
  type Fact,
} from "@/lib/nemotron/dataset-builder";
import { useYen } from "@/components/account/hooks";
import { Field } from "./ui";
import { useConfirm } from "@/components/ui/useConfirm";

type Row = BuiltExample & { key: string };

export type BuiltDataset = {
  trainJsonl: string;
  evalJsonl: string | null;
  trainCount: number;
  evalCount: number;
  role: string;
};

/**
 * Nemotron で学習データを作る。資料から事実を取り出し、事実ごとに言い方を変えた質問を作って並べる (runBuild)。
 * 「作り直す」は資料から作って置きかえる。「追加で作る」は前回の事実をもう一度言い換えて、いまの例に足す
 * (事実はこの画面の中だけで持つ。資料から取り出し直さないので、追加は言い換えの分の料金だけで済む)。
 * 作者は例を直したり消したり、評価用に回すかを選んでから、学習データとして使う。
 */
export function DatasetBuilder({
  modelId,
  onUse,
}: {
  modelId: string;
  onUse: (dataset: BuiltDataset) => void;
}) {
  const { t } = useTranslation();
  const [confirm, confirmDialog] = useConfirm();
  const yen = useYen();
  const queryClient = useQueryClient();
  const [role, setRole] = useState("");
  const [material, setMaterial] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dropped, setDropped] = useState(0);
  const [failedChunks, setFailedChunks] = useState(0);
  const [spent, setSpent] = useState(0);
  const stopRef = useRef(false);
  const running = progress !== null && progress.done < progress.total;

  const chunks = useMemo(() => chunkMaterial(material), [material]);
  // 回数と料金の見込み。作る前は資料から事実の数を見積もり、追加は前回の事実の数で決まる
  const estimate = useMemo(
    () => ({
      initial: estimateBuild(chunks, role.length, tokenFactoryHoldMicros),
      more: estimateParaphrase(
        facts.length,
        facts.reduce((sum, fact) => sum + JSON.stringify(fact).length, 0),
        role.length,
        tokenFactoryHoldMicros,
      ),
    }),
    [chunks, role, facts],
  );
  const canStart = !running && role.trim().length > 0;
  const canBuild = canStart && material.trim().length > 0 && material.length <= BUILDER_MATERIAL_MAX_CHARS;
  const canAppend = canStart && facts.length > 0;

  const trainCount = rows.filter((row) => !row.heldOut).length;
  const evalCount = rows.length - trainCount;
  const allFilled = rows.every((row) => row.user.trim() && row.assistant.trim());
  const canUse = !running && allFilled && trainCount >= DATASET_MIN_EXAMPLES;

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setMaterial(text.slice(0, BUILDER_MATERIAL_MAX_CHARS));
    if (text.length > BUILDER_MATERIAL_MAX_CHARS) toast.warning(t("models.builder.truncated"));
  };

  /** replace: 資料から作り直す (いまの例を置きかえる) / append: 前回の事実を言い換えて、いまの例に足す */
  const generate = async (mode: "replace" | "append") => {
    const append = mode === "append";
    if (!(append ? canAppend : canBuild)) return;
    if (!append && rows.length && !(await confirm(t("models.builder.regenerateConfirm")))) return;
    const base = append ? rows : [];
    const assistantRole = role.trim();
    stopRef.current = false;
    setDropped(0);
    setFailedChunks(0);
    setSpent(0);
    setRows(base);
    setProgress({ done: 0, total: append ? estimate.more.calls : chunks.length });
    const added: Row[] = [];
    const toRow = (example: BuiltExample): Row => ({ ...example, key: crypto.randomUUID() });
    const result = await runBuild(
      {
        chunks: append ? 0 : chunks.length,
        facts: append ? facts : [],
        existingQuestions: base.map((row) => row.user),
        heldOut: base.filter((row) => row.heldOut).length,
      },
      {
        extract: (chunk) =>
          extractDatasetFacts(modelId, { role: assistantRole, material, chunk }),
        paraphrase: (batch) =>
          paraphraseDatasetFacts(modelId, { role: assistantRole, facts: batch }),
        shouldStop: () => stopRef.current,
        isFatal: (error) => error instanceof ApiError && error.status === 402,
        onProgress: (state) => {
          // 新しく届いた分だけ行にする (key を保って入力欄を作り直さない)
          added.push(...state.examples.slice(added.length).map(toRow));
          setRows([...base, ...added]);
          setDropped(state.dropped);
          setFailedChunks(state.failed);
          setSpent(state.costMicros);
          setProgress({ done: state.done, total: state.total });
        },
      },
    );
    if (result.outcome === "fatal" && result.error instanceof Error) toast.error(result.error.message);
    // 止めたときや失敗したときは、言い換えていない事実も元の質問だけで届く
    added.push(...result.examples.slice(added.length).map(toRow));
    setRows([...base, ...added]);
    setFacts(result.facts);
    setDropped(result.dropped);
    setFailedChunks(result.failed);
    setSpent(result.costMicros);
    setProgress({ done: result.total, total: result.total });
    await queryClient.invalidateQueries({ queryKey: ["wallet"] });
  };

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const use = () => {
    if (!canUse) return;
    const clean = (list: Row[]) =>
      list.map((row) => ({ user: row.user.trim(), assistant: row.assistant.trim() }));
    const train = clean(rows.filter((row) => !row.heldOut));
    const held = clean(rows.filter((row) => row.heldOut));
    onUse({
      trainJsonl: examplesToJsonl(train),
      evalJsonl: held.length ? examplesToJsonl(held) : null,
      trainCount: train.length,
      evalCount: held.length,
      role: role.trim(),
    });
  };

  return (
    <div className="space-y-5 rounded-(--radius-control) border border-line bg-paper p-4">
      {confirmDialog}
      <p className="text-sm leading-6 text-ink-soft">{t("models.builder.intro")}</p>
      <Field label={t("models.builder.role")}>
        <textarea
          className="console-input h-auto min-h-20 resize-y py-2 leading-6"
          value={role}
          maxLength={BUILDER_ROLE_MAX_CHARS}
          placeholder={t("models.builder.rolePlaceholder")}
          disabled={running}
          onChange={(event) => setRole(event.target.value)}
        />
      </Field>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span className="console-label">{t("models.builder.material")}</span>
          <label className="mb-1.5 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-brand-ink hover:text-ink">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {t("models.builder.loadFile")}
            <input
              className="sr-only"
              type="file"
              accept=".txt,.md,.markdown,.csv,text/plain,text/markdown"
              disabled={running}
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
          </label>
        </div>
        <textarea
          className="console-input h-auto min-h-48 resize-y py-2 font-mono text-xs leading-5"
          value={material}
          maxLength={BUILDER_MATERIAL_MAX_CHARS}
          placeholder={t("models.builder.materialPlaceholder")}
          disabled={running}
          aria-label={t("models.builder.material")}
          onChange={(event) => setMaterial(event.target.value)}
        />
        <span className="console-hint num">
          {t("models.builder.materialHint", {
            chars: material.length.toLocaleString(),
            max: BUILDER_MATERIAL_MAX_CHARS.toLocaleString(),
            chunks: chunks.length,
          })}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="num space-y-0.5 text-xs text-ink-mute">
          {chunks.length > 0 && !running && (
            <>
              <p>
                {t("models.builder.estimate", {
                  facts: estimate.initial.facts,
                  examples: estimate.initial.examples,
                  calls: estimate.initial.calls,
                  amount: yen(estimate.initial.holdMicros),
                })}
              </p>
              {facts.length > 0 && (
                <p>
                  {t("models.builder.estimateMore", {
                    facts: facts.length,
                    examples: facts.length * BUILDER_PARAPHRASES,
                    calls: estimate.more.calls,
                    amount: yen(estimate.more.holdMicros),
                  })}
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <button
              className="console-button-secondary"
              type="button"
              onClick={() => {
                stopRef.current = true;
              }}
            >
              <Square className="h-4 w-4" />
              {t("models.builder.stop")}
            </button>
          ) : rows.length ? (
            <>
              <button
                className="console-button-secondary"
                type="button"
                disabled={!canBuild}
                onClick={() => void generate("replace")}
              >
                <Sparkles className="h-4 w-4" />
                {t("models.builder.regenerate")}
              </button>
              <button
                className="console-button-primary"
                type="button"
                disabled={!canAppend}
                onClick={() => void generate("append")}
              >
                <Plus className="h-4 w-4" />
                {t("models.builder.generateMore")}
              </button>
            </>
          ) : (
            <button
              className="console-button-primary"
              type="button"
              disabled={!canBuild}
              onClick={() => void generate("replace")}
            >
              <Sparkles className="h-4 w-4" />
              {t("models.builder.generate")}
            </button>
          )}
        </div>
      </div>

      {progress && (
        <div className="space-y-1.5" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-brand-ink transition-[width]"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="num text-xs text-ink-mute">
            {t("models.builder.progress", {
              done: progress.done,
              total: progress.total,
              examples: rows.length,
              amount: yen(spent),
            })}
            {dropped > 0 && ` · ${t("models.builder.dropped", { count: dropped })}`}
            {failedChunks > 0 && ` · ${t("models.builder.failedChunks", { count: failedChunks })}`}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">{t("models.builder.previewTitle")}</h3>
            <span className="num text-xs text-ink-mute">
              {t("models.builder.split", { train: trainCount, eval: evalCount })}
            </span>
          </div>
          <ol className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className={`space-y-2 rounded-(--radius-control) border bg-surface p-3 ${
                  row.heldOut ? "border-signal/40" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="num text-xs font-semibold text-ink-mute">#{index + 1}</span>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-brand"
                        checked={row.heldOut}
                        disabled={running}
                        onChange={(event) => update(row.key, { heldOut: event.target.checked })}
                      />
                      {t("models.builder.heldOut")}
                    </label>
                    <button
                      type="button"
                      className="rounded-full p-1 text-ink-mute hover:bg-line hover:text-danger"
                      aria-label={t("models.builder.remove", { index: index + 1 })}
                      disabled={running}
                      onClick={() => setRows((prev) => prev.filter((item) => item.key !== row.key))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <label className="block">
                  <span className="text-[11px] font-semibold text-ink-mute">{t("models.builder.user")}</span>
                  <textarea
                    className="console-input mt-1 h-auto min-h-12 resize-y py-1.5 text-sm leading-6"
                    value={row.user}
                    disabled={running}
                    onChange={(event) => update(row.key, { user: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-ink-mute">
                    {t("models.builder.assistant")}
                  </span>
                  <textarea
                    className="console-input mt-1 h-auto min-h-20 resize-y py-1.5 text-sm leading-6"
                    value={row.assistant}
                    disabled={running}
                    onChange={(event) => update(row.key, { assistant: event.target.value })}
                  />
                </label>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-xs text-ink-mute">
              {trainCount < DATASET_MIN_EXAMPLES
                ? t("models.builder.needMore", { min: DATASET_MIN_EXAMPLES })
                : !allFilled
                  ? t("models.builder.emptyRows")
                  : evalCount === 0
                    ? t("models.builder.noEvalWarning")
                    : t("models.builder.ready")}
            </p>
            <button className="console-button-primary" type="button" disabled={!canUse} onClick={use}>
              {t("models.builder.use", { count: trainCount })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
