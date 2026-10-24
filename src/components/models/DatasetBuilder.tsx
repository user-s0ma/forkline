import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Sparkles, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, generateDatasetChunk } from "@/lib/api-client";
import { tokenFactoryHoldMicros } from "@/lib/billing/compute";
import { DATASET_MIN_EXAMPLES } from "@/lib/models/dataset";
import {
  BUILDER_DEFAULT_PER_CHUNK,
  BUILDER_MATERIAL_MAX_CHARS,
  BUILDER_MAX_PER_CHUNK,
  BUILDER_MAX_TOKENS,
  BUILDER_ROLE_MAX_CHARS,
  chunkMaterial,
  examplesToJsonl,
  pickHeldOut,
} from "@/lib/nemotron/dataset-builder";
import { useYen } from "@/components/account/hooks";
import { Field, NumberInput } from "./ui";

type Row = { key: string; user: string; assistant: string; heldOut: boolean };

export type BuiltDataset = {
  trainJsonl: string;
  evalJsonl: string | null;
  trainCount: number;
  evalCount: number;
  role: string;
};

/**
 * Nemotron で学習データを作る。資料をかたまりに分けて1つずつ送り、返ってきた例を並べる。
 * 作者は例を直したり消したり、評価用に回すかを選んでから、学習データとして使う。
 */
export function DatasetBuilder({
  organizationId,
  modelId,
  onUse,
}: {
  organizationId: string;
  modelId: string;
  onUse: (dataset: BuiltDataset) => void;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const queryClient = useQueryClient();
  const [role, setRole] = useState("");
  const [material, setMaterial] = useState("");
  const [perChunk, setPerChunk] = useState<number | null>(BUILDER_DEFAULT_PER_CHUNK);
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dropped, setDropped] = useState(0);
  const [failedChunks, setFailedChunks] = useState(0);
  const [spent, setSpent] = useState(0);
  const stopRef = useRef(false);
  const running = progress !== null && progress.done < progress.total;

  const chunks = useMemo(() => chunkMaterial(material), [material]);
  const estimate = useMemo(
    () =>
      chunks.reduce(
        (sum, chunk) =>
          sum +
          tokenFactoryHoldMicros({
            inputChars: chunk.length + role.length + 2_000,
            maxTokens: BUILDER_MAX_TOKENS,
          }),
        0,
      ),
    [chunks, role],
  );
  const count = perChunk !== null && perChunk >= 1 && perChunk <= BUILDER_MAX_PER_CHUNK ? perChunk : null;
  const canGenerate =
    !running &&
    count !== null &&
    role.trim().length > 0 &&
    material.trim().length > 0 &&
    material.length <= BUILDER_MATERIAL_MAX_CHARS;

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

  const generate = async () => {
    if (!canGenerate || count === null) return;
    if (rows.length && !window.confirm(t("models.builder.regenerateConfirm"))) return;
    stopRef.current = false;
    setDropped(0);
    setFailedChunks(0);
    setSpent(0);
    const collected: Row[] = [];
    setRows([]);
    setProgress({ done: 0, total: chunks.length });
    for (let chunk = 0; chunk < chunks.length; chunk += 1) {
      if (stopRef.current) break;
      try {
        const result = await generateDatasetChunk(organizationId, modelId, {
          role: role.trim(),
          material,
          chunk,
          perChunk: count,
          seenQuestions: collected.map((row) => row.user),
        });
        collected.push(
          ...result.examples.map((example) => ({
            key: crypto.randomUUID(),
            user: example.user,
            assistant: example.assistant,
            heldOut: false,
          })),
        );
        setRows([...collected]);
        setDropped((value) => value + result.dropped.length);
        setSpent((value) => value + result.costMicros);
      } catch (error) {
        if (error instanceof ApiError && error.status === 402) {
          toast.error(error.message);
          break;
        }
        setFailedChunks((value) => value + 1);
      }
      setProgress({ done: chunk + 1, total: chunks.length });
    }
    // 評価用に回す例を選ぶ (作者はあとで1件ずつ切り替えられる)
    const picked = pickHeldOut(collected.length, { seed: Date.now() % 2_147_483_647 });
    setRows(collected.map((row, index) => ({ ...row, heldOut: picked.has(index) })));
    setProgress((value) => (value ? { done: value.total, total: value.total } : value));
    await queryClient.invalidateQueries({ queryKey: ["wallet", organizationId] });
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
      <p className="text-sm leading-6 text-ink-soft">{t("models.builder.intro")}</p>
      <Field label={t("models.builder.role")} hint={t("models.builder.roleHint")}>
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Field
          className="w-48"
          label={t("models.builder.perChunk")}
          hint={t("models.builder.perChunkHint", { max: BUILDER_MAX_PER_CHUNK })}
        >
          <NumberInput
            value={perChunk}
            min={1}
            max={BUILDER_MAX_PER_CHUNK}
            step={1}
            disabled={running}
            onChange={setPerChunk}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          {chunks.length > 0 && !running && (
            <span className="num text-xs text-ink-mute">
              {t("models.builder.estimate", { amount: yen(estimate) })}
            </span>
          )}
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
          ) : (
            <button
              className="console-button-primary"
              type="button"
              disabled={!canGenerate}
              onClick={() => void generate()}
            >
              <Sparkles className="h-4 w-4" />
              {rows.length ? t("models.builder.regenerate") : t("models.builder.generate")}
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
          <p className="text-xs leading-5 text-ink-mute">{t("models.builder.previewHint")}</p>
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
