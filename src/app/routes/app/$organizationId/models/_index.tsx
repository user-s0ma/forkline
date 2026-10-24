import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate, useOutletContext } from "react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Route } from "./+types/_index";
import { EndpointBadge, ModelLamp } from "@/components/models/ui";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { Modal } from "@/components/ui/Modal";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { createModel, listModels } from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";
import type { AppLayoutContext } from "../../_layout";

export default function ModelsPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const organizationId = params.organizationId;
  const base = `/app/${encodeURIComponent(organizationId)}/models`;
  const detailPath = (modelId: string) => `${base}/${encodeURIComponent(modelId)}`;
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "medium" }),
    [locale],
  );
  const { openMobileNavigation } = useOutletContext<AppLayoutContext>();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, error, isPending, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ["models", organizationId],
      queryFn: ({ pageParam }) =>
        listModels(organizationId, { cursor: pageParam, pageSize: 50 }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
  const models = data?.pages.flatMap((page) => page.items) ?? [];

  const loadMore = useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (!error) return;
    console.error(error);
    toast.error(error instanceof Error ? error.message : t("models.list.loadError"));
  }, [error, t]);

  return (
    <>
      <PageHeader
        title={t("models.list.title")}
        description={t("models.list.description")}
        onOpenMenu={openMobileNavigation}
        actions={
          models.length > 0 && (
            <button
              className="console-button-primary"
              type="button"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t("models.list.newButton")}
            </button>
          )
        }
      />
      <PageBody>
        {isPending ? (
          <div className="console-panel overflow-hidden">
            <ListSkeleton />
          </div>
        ) : models.length === 0 ? (
          <EmptyModels onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="console-panel overflow-x-auto">
            <ul className="divide-y divide-line sm:hidden">
              {models.map((model) => (
                <li key={model.id}>
                  <Link
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper"
                    to={detailPath(model.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{model.name}</span>
                      <span className="mt-0.5 block truncate font-mono text-xs text-ink-mute">
                        {model.slug}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
                      <ModelLamp model={model} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <table className="console-table hidden min-w-[44rem] table-fixed sm:table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th className="w-40">{t("common.status")}</th>
                  <th className="w-32">{t("models.list.endpoint")}</th>
                  <th className="w-24 text-right">{t("models.list.requests")}</th>
                  <th className="hidden w-32 lg:table-cell">{t("models.list.updatedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr
                    key={model.id}
                    className="is-clickable"
                    onClick={() => navigate(detailPath(model.id))}
                  >
                    <td className="min-w-0">
                      <Link
                        className="block min-w-0 rounded-sm"
                        to={detailPath(model.id)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="block truncate font-semibold text-ink">{model.name}</span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-ink-mute">
                          {model.slug}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <ModelLamp model={model} />
                    </td>
                    <td>
                      <EndpointBadge status={model.endpointStatus} />
                    </td>
                    <td className="num text-right text-ink">
                      {model.totalRequests.toLocaleString(localeTag(locale))}
                    </td>
                    <td className="hidden text-ink-mute lg:table-cell">
                      {dateFormatter.format(new Date(model.updatedAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasNextPage && <InfiniteScrollSentinel onLoadMore={loadMore} rows={2} />}
          </div>
        )}
      </PageBody>
      {createOpen && (
        <CreateModelModal
          organizationId={organizationId}
          onCreated={(modelId) => navigate(detailPath(modelId))}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </>
  );
}

function EmptyModels({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="console-panel p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">{t("models.list.emptyTitle")}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-mute">
        {t("models.list.emptyDescription")}
      </p>
      <div className="mt-6 max-w-2xl rounded-(--radius-panel) border border-line p-5">
        <p className="text-sm font-semibold text-ink">{t("models.create.flowTitle")}</p>
        <p className="mt-1 text-sm leading-6 text-ink-mute">{t("models.create.flowSummary")}</p>
      </div>
      <button className="console-button-primary mt-6" type="button" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        {t("models.list.createFirst")}
      </button>
    </section>
  );
}

function CreateModelModal({
  organizationId,
  onCreated,
  onClose,
}: {
  organizationId: string;
  onCreated: (modelId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    try {
      const model = await createModel(organizationId, { name: trimmed });
      onCreated(model.id);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : t("models.list.createFailed"));
      setIsCreating(false);
    }
  };

  return (
    <Modal title={t("models.create.title")} onClose={onClose}>
      <form className="space-y-5 p-5" onSubmit={handleCreate}>
        <label className="block">
          <span className="console-label">{t("common.name")}</span>
          <input
            className="console-input"
            value={name}
            maxLength={80}
            autoFocus
            placeholder={t("models.create.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="text-sm leading-6 text-ink-mute">{t("models.create.flowSummary")}</p>
        <div className="flex justify-end gap-2">
          <button className="console-button-secondary" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="console-button-primary"
            type="submit"
            disabled={!name.trim() || isCreating}
          >
            {isCreating ? t("common.creating") : t("models.create.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
