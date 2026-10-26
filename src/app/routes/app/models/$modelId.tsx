import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useOutletContext } from "react-router";
import { SearchX, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Route } from "./+types/$modelId";
import { ApiSnippet } from "@/components/models/ApiSnippet";
import { EndpointPanel } from "@/components/models/EndpointPanel";
import { EvaluationPanel } from "@/components/models/EvaluationPanel";
import { LaunchPanel } from "@/components/models/LaunchPanel";
import { PricingPanel } from "@/components/models/PricingPanel";
import { RuntimeForm } from "@/components/models/RuntimeForm";
import { StatsPanel } from "@/components/models/StatsPanel";
import { TestPanel } from "@/components/models/TestPanel";
import { DemoGuide } from "@/components/models/DemoGuide";
import { isDemoUser } from "@/lib/auth/demo-account";
import { TrainingPanel } from "@/components/models/TrainingPanel";
import { useBaseModels } from "@/components/models/hooks";
import { Field, ModelLamp, Section } from "@/components/models/ui";
import { ConsoleSelect } from "@/components/ui/ConsoleSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import {
  ApiError,
  deleteModel,
  getModel,
  updateModel,
  type ModelRecord,
  type ModelUpdateInput,
} from "@/lib/api-client";
import { MODEL_CATEGORIES, SLUG_PATTERN } from "@/lib/billing/pricing";
import type { AppLayoutContext } from "../_layout";

const TABS = ["overview", "training", "test", "evaluation", "settings"] as const;
type Tab = (typeof TABS)[number];

const SETTINGS_SECTIONS = ["general", "runtime", "pricing", "danger"] as const;
const sectionId = (section: (typeof SETTINGS_SECTIONS)[number]) => `settings-${section}`;

function toDraft(model: ModelRecord): ModelUpdateInput {
  return {
    slug: model.slug,
    name: model.name,
    tagline: model.tagline,
    description: model.description,
    category: model.category,
    tags: model.tags,
    config: model.config,
    pricing: {
      priceInputMicros: model.priceInputMicros,
      priceOutputMicros: model.priceOutputMicros,
      pricePerRequestMicros: model.pricePerRequestMicros,
    },
  };
}

export default function ModelEditorPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modelId } = params;
  const listPath = "/app/models";
  const { openMobileNavigation } = useOutletContext<AppLayoutContext>();
  const [tab, setTab] = useState<Tab | null>(null);
  const [revision, setRevision] = useState(0);

  const { data: model, error, isPending, refetch } = useQuery({
    queryKey: ["model", modelId],
    queryFn: () => getModel(modelId),
    retry: (count, failure) =>
      !(failure instanceof ApiError && failure.status === 404) && count < 1,
  });
  const notFound = error instanceof ApiError && error.status === 404;

  useEffect(() => {
    if (!error || notFound) return;
    console.error(error);
    toast.error(error instanceof Error ? error.message : t("models.editor.loadError"));
  }, [error, notFound, t]);

  const refresh = useCallback(async () => {
    await refetch();
    await queryClient.invalidateQueries({ queryKey: ["models"] });
  }, [queryClient, refetch]);

  if (isPending || !model) {
    return (
      <>
        <PageHeader
          title={t("models.list.title")}
          back={{ to: listPath, label: t("models.editor.backToList") }}
          onOpenMenu={openMobileNavigation}
        />
        <PageBody>
          {notFound ? (
            <EmptyState
              icon={SearchX}
              title={t("models.editor.notFoundTitle")}
              description={t("models.editor.notFoundDescription")}
              action={
                <Link className="console-button-secondary" to={listPath}>
                  {t("models.editor.backToList")}
                </Link>
              }
              className="console-panel"
            />
          ) : error ? (
            <p className="console-panel p-6 text-sm text-ink-mute">
              {t("models.editor.loadError")}
            </p>
          ) : (
            <div className="console-panel overflow-hidden">
              <ListSkeleton />
            </div>
          )}
        </PageBody>
      </>
    );
  }

  // まだデプロイしていないモデルは「学習」から開く
  const initialTab: Tab = model.endpointId ? "overview" : "training";

  return (
    <ModelEditor
      key={`${model.id}:${revision}`}
      listPath={listPath}
      model={model}
      tab={tab ?? initialTab}
      onTabChange={setTab}
      onRefresh={refresh}
      onSaved={async () => {
        await refresh();
        setRevision((value) => value + 1);
      }}
      onDeleted={async () => {
        await queryClient.invalidateQueries({ queryKey: ["models"] });
        navigate(listPath, { replace: true });
      }}
    />
  );
}

function ModelEditor({
  listPath,
  model,
  tab,
  onTabChange,
  onRefresh,
  onSaved,
  onDeleted,
}: {
  listPath: string;
  model: ModelRecord;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onRefresh: () => Promise<unknown>;
  onSaved: () => Promise<unknown>;
  onDeleted: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { openMobileNavigation, user } = useOutletContext<AppLayoutContext>();
  const [draft, setDraft] = useState<ModelUpdateInput>(() => toDraft(model));
  const [isSaving, setIsSaving] = useState(false);
  const baseModels = useBaseModels();
  const serveRate =
    baseModels.data?.items.find((option) => option.id === model.baseModelId)
      ?.serveMicrosPerHour ?? null;

  const isDirty = JSON.stringify(draft) !== JSON.stringify(toDraft(model));
  const slugValid = SLUG_PATTERN.test(draft.slug);
  const canSave = isDirty && slugValid && Boolean(draft.name.trim()) && !isSaving;
  const publicHref = `/models/${model.slug}`;
  const isPublic = model.status === "published" && model.visibility === "public";
  const testDisabled = model.endpointId ? null : t("models.test.deployFirst");

  const set = (patch: Partial<ModelUpdateInput>) => setDraft((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await updateModel(model.id, {
        ...draft,
        name: draft.name.trim(),
        slug: draft.slug.trim(),
      });
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : t("models.editor.saveFailed"));
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: listPath, label: t("models.editor.backToList") }}
        title={model.name}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-mono text-ink-soft">{model.slug}</span>
            <ModelLamp model={model} />
          </span>
        }
        actions={
          isPublic && (
            <a className="console-button-secondary" href={publicHref} target="_blank" rel="noreferrer">
              {t("models.editor.viewPublic")}
            </a>
          )
        }
        onOpenMenu={openMobileNavigation}
      />
      <PageBody>
        <div
          className="-mt-1 flex gap-6 overflow-x-auto border-b border-line"
          role="tablist"
          aria-label={t("models.editor.tabsAria")}
        >
          {TABS.map((candidate) => {
            const selected = tab === candidate;
            return (
              <button
                key={candidate}
                id={`model-tab-${candidate}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`model-panel-${candidate}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTabChange(candidate)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  const offset = event.key === "ArrowRight" ? 1 : -1;
                  const next = TABS[(TABS.indexOf(candidate) + offset + TABS.length) % TABS.length];
                  onTabChange(next);
                  document.getElementById(`model-tab-${next}`)?.focus();
                }}
                className={`-mb-px shrink-0 border-b-2 pt-1 pb-3 text-sm transition-colors ${
                  selected
                    ? "border-brand-ink font-semibold text-ink"
                    : "border-transparent text-ink-mute hover:text-ink"
                }`}
              >
                {t(`models.editor.tabs.${candidate}`)}
              </button>
            );
          })}
        </div>

        <div
          id={`model-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`model-tab-${tab}`}
          className="space-y-6"
        >
          {tab === "overview" && (
            <>
              <LaunchPanel
                model={model}
                isDirty={isDirty}
                onOpenTab={onTabChange}
                onChanged={onRefresh}
              />
              <StatsPanel modelId={model.id} />
              <ApiSnippet slug={model.slug} />
            </>
          )}

          {tab === "training" && (
            <>
              <EndpointPanel
                model={model}
                onChanged={onRefresh}
              />
              <TrainingPanel model={model} onChanged={onRefresh} />
            </>
          )}

          {tab === "evaluation" && (
            <EvaluationPanel
              model={model}
              onApplyCard={(card) => {
                // 下書きは設定の欄に入れるだけ。保存は作者が設定の画面で確かめてから行う
                set({ tagline: card.tagline, description: card.description, tags: card.tags.slice(0, 10) });
                onTabChange("settings");
                toast.success(t("models.card.applied"));
              }}
            />
          )}

          {tab === "settings" && (
            <div className="grid gap-8 lg:grid-cols-[10rem_minmax(0,1fr)]">
              <nav className="hidden lg:block" aria-label={t("models.settings.navAria")}>
                <ul className="sticky top-6 space-y-1">
                  {SETTINGS_SECTIONS.map((section) => (
                    <li key={section}>
                      <a
                        className="block rounded-(--radius-control) px-3 py-1.5 text-sm text-ink-soft hover:bg-paper hover:text-ink"
                        href={`#${sectionId(section)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          document
                            .getElementById(sectionId(section))
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        {t(`models.settings.nav.${section}`)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="min-w-0 space-y-6">
                <GeneralSection draft={draft} slugValid={slugValid} onChange={set} />
                <RuntimeForm
                  id={sectionId("runtime")}
                  config={draft.config}
                  onChange={(config) => set({ config })}
                />
                <PricingPanel
                  id={sectionId("pricing")}
                  endpointMicrosPerHour={serveRate}
                  pricing={draft.pricing}
                  onChange={(pricing) => set({ pricing })}
                />
                <DangerZone model={model} onDeleted={onDeleted} />
              </div>
            </div>
          )}

          {/* テストの会話はタブを切り替えても残るよう、非表示にするだけでアンマウントしない */}
          <div hidden={tab !== "test"} className="space-y-6">
            {isDemoUser(user) && <DemoGuide />}
            <TestPanel
              slug={model.slug}
              disabledReason={testDisabled}
            />
          </div>
        </div>

        {isDirty && (
          <div
            className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border border-line-strong bg-raised px-4 py-3 shadow-lg"
            role="status"
          >
            <p className="text-sm text-ink">
              {t("models.editor.unsaved")}
              {!slugValid && (
                <span className="ml-2 text-danger">{t("models.general.slugInvalid")}</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                className="console-button-secondary"
                type="button"
                disabled={isSaving}
                onClick={() => setDraft(toDraft(model))}
              >
                {t("models.editor.discard")}
              </button>
              <button
                className="console-button-primary"
                type="button"
                disabled={!canSave}
                onClick={() => void handleSave()}
              >
                {isSaving ? t("common.saving") : t("models.editor.save")}
              </button>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

function GeneralSection({
  draft,
  slugValid,
  onChange,
}: {
  draft: ModelUpdateInput;
  slugValid: boolean;
  onChange: (patch: Partial<ModelUpdateInput>) => void;
}) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState("");

  const addTag = () => {
    const tag = tagInput.trim().slice(0, 32);
    setTagInput("");
    if (!tag || draft.tags.includes(tag) || draft.tags.length >= 10) return;
    onChange({ tags: [...draft.tags, tag] });
  };

  return (
    <div id={sectionId("general")} className="scroll-mt-6">
      <Section title={t("models.general.title")} description={t("models.general.intro")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("common.name")}>
            <input
              className="console-input"
              value={draft.name}
              maxLength={80}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>
          <Field
            label={t("models.general.slug")}
            hint={
              slugValid ? undefined : (
                <span className="text-danger">{t("models.general.slugInvalid")}</span>
              )
            }
          >
            <input
              className="console-input font-mono"
              value={draft.slug}
              maxLength={64}
              aria-invalid={!slugValid}
              onChange={(event) => onChange({ slug: event.target.value.toLowerCase() })}
            />
          </Field>
        </div>
        <Field label={t("models.general.tagline")}>
          <input
            className="console-input"
            value={draft.tagline}
            maxLength={160}
            placeholder={t("models.general.taglinePlaceholder")}
            onChange={(event) => onChange({ tagline: event.target.value })}
          />
        </Field>
        <Field label={t("models.general.description")}>
          <textarea
            className="console-input h-auto min-h-40 resize-y py-2 leading-6"
            value={draft.description}
            maxLength={50_000}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("models.general.category")}>
            <ConsoleSelect
              value={draft.category}
              ariaLabel={t("models.general.category")}
              options={MODEL_CATEGORIES.map((category) => ({
                value: category,
                label: t(`models.categories.${category}`),
              }))}
              onChange={(category) => onChange({ category })}
            />
          </Field>
          <div>
            <span className="console-label">{t("models.general.tags")}</span>
            <input
              className="console-input"
              value={tagInput}
              maxLength={32}
              disabled={draft.tags.length >= 10}
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
                      onClick={() => onChange({ tags: draft.tags.filter((item) => item !== tag) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

function DangerZone({
  model,
  onDeleted,
}: {
  model: ModelRecord;
  onDeleted: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (confirmText !== model.slug || busy) return;
    setBusy(true);
    try {
      await deleteModel(model.id);
      await onDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("models.danger.failed"));
      setBusy(false);
    }
  };

  return (
    <section
      id={sectionId("danger")}
      className="scroll-mt-6 rounded-(--radius-panel) border border-danger/30 bg-surface p-5 sm:p-6"
    >
      <h2 className="text-sm font-semibold text-danger">{t("models.danger.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-mute">
        {t("models.danger.description")}
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="console-label">
            {t("models.danger.confirmPrompt", { slug: model.slug })}
          </span>
          <input
            className="console-input font-mono"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
        </label>
        <button
          className="console-button-danger"
          type="button"
          disabled={confirmText !== model.slug || busy}
          onClick={() => void handleDelete()}
        >
          {busy ? t("models.danger.deleting") : t("models.danger.delete")}
        </button>
      </div>
    </section>
  );
}
