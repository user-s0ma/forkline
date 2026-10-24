import { useCallback, useEffect, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity, Menu, ShieldAlert } from "lucide-react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/audit-logs";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { ConsoleSelect } from "@/components/ui/ConsoleSelect";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { localeTag, useLocale } from "@/lib/i18n";
import type { AuditAction } from "@/lib/organization/audit";
import { listAuditLogs, type AuditLogItem } from "@/lib/api";
import type { AppLayoutContext } from "../_layout";

const ACTION_GROUPS: Array<{ key: string; actions: AuditAction[] }> = [
  {
    key: "organization",
    actions: [
      "organization.create",
      "organization.update",
      "organization.delete",
    ],
  },
  {
    key: "members",
    actions: [
      "invitation.create",
      "invitation.accept",
      "invitation.reject",
      "invitation.cancel",
      "member.role_update",
      "member.remove",
      "member.leave",
    ],
  },
  {
    key: "models",
    actions: [
      "model.create",
      "model.update",
      "model.publish",
      "model.unpublish",
      "model.delete",
    ],
  },
  {
    key: "compute",
    actions: [
      "fine_tune.start",
      "fine_tune.cancel",
      "endpoint.deploy",
      "endpoint.start",
      "endpoint.stop",
      "endpoint.delete",
      "dataset.generate",
      "evaluation.start",
      "model_card.draft",
    ],
  },
  {
    key: "billing",
    actions: [
      "api_key.create",
      "api_key.revoke",
      "billing.topup_start",
      "billing.connect",
      "billing.payout",
    ],
  },
];

export default function AuditLogsPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { organizations, isOrganizationsLoading, openMobileNavigation } =
    useOutletContext<AppLayoutContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get("action") || "";

  const actionOptions = useMemo(
    () => [
      { value: "", label: t("auditLogs.allActions") },
      ...ACTION_GROUPS.flatMap((group) =>
        group.actions.map((value) => ({
          value,
          label: t(`auditLogs.actions.${value}`),
          group: t(`auditLogs.actionGroups.${group.key}`),
        })),
      ),
    ],
    [t],
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const detailText = (item: AuditLogItem) => {
    const parts: string[] = [];
    const role = item.metadata.role;
    if (typeof role === "string" && role) {
      parts.push(
        t("auditLogs.roleDetail", {
          role: t(`common.roles.${role}`, { defaultValue: role }),
        }),
      );
    }
    const from = item.metadata.from;
    if (typeof from === "string" && from) {
      parts.push(t("auditLogs.fromDetail", { from }));
    }
    return parts.join(t("auditLogs.detailSeparator"));
  };

  const organization = organizations.find(
    (item) => item.id === params.organizationId,
  );

  const {
    data,
    error,
    isPending,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["audit-logs", params.organizationId, action],
    queryFn: ({ pageParam }) =>
      listAuditLogs(params.organizationId, {
        cursor: pageParam,
        action,
        pageSize: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    enabled: !isOrganizationsLoading && Boolean(organization),
  });
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  const loadMore = useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (!error) return;
    console.error(error);
    toast.error(
      error instanceof Error ? error.message : t("auditLogs.loadError"),
    );
  }, [error, t]);

  useEffect(() => {
    if (isOrganizationsLoading) return;
    if (!organization) navigate("/app", { replace: true });
  }, [isOrganizationsLoading, navigate, organization]);

  return (
    <>
      <header className="sticky top-0 z-20 h-16 border-b border-line bg-surface">
        <div className="flex h-full items-center justify-between gap-2 px-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-mute hover:bg-paper hover:text-ink lg:hidden"
              type="button"
              aria-label={t("common.openMenu")}
              onClick={openMobileNavigation}
            >
              <Menu className="h-4 w-4" />
            </button>
            <span className="truncate text-sm mx-2">
              {t("auditLogs.title")}
            </span>
          </div>
          <ConsoleSelect
            ariaLabel={t("auditLogs.filterByAction")}
            className="w-full max-w-52"
            onChange={(next) =>
              setSearchParams(
                (previous) => {
                  const params = new URLSearchParams(previous);
                  if (next) params.set("action", next);
                  else params.delete("action");
                  return params;
                },
                { replace: true },
              )
            }
            options={actionOptions}
            value={action}
          />
        </div>
      </header>

      <main className="w-full">
        <section>
          <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(10rem,1.25fr)_minmax(10rem,1.25fr)_9rem] gap-2 bg-paper px-4 py-3 text-xs text-ink-mute sm:grid">
            <span>{t("auditLogs.actionHeader")}</span>
            <span>{t("auditLogs.actorHeader")}</span>
            <span>{t("auditLogs.targetHeader")}</span>
            <span className="text-right">{t("auditLogs.dateHeader")}</span>
          </div>

          {isPending && !error ? (
            <ListSkeleton />
          ) : error ? (
            <EmptyState
              icon={ShieldAlert}
              title={t("auditLogs.errorTitle")}
              description={
                error instanceof Error
                  ? error.message
                  : t("auditLogs.loadErrorDescription")
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={t("auditLogs.emptyTitle")}
              description={
                action
                  ? t("auditLogs.emptyFilteredDescription")
                  : t("auditLogs.emptyDescription")
              }
            />
          ) : (
            <>
              <div className="divide-y divide-line">
                {items.map((item) => {
                  const detail = detailText(item);
                  return (
                    <div
                      className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1.25fr)_minmax(10rem,1.25fr)_9rem]"
                      key={item.id}
                    >
                      <span className="min-w-0">
                        <span className="mx-2 block truncate text-sm sm:mx-0 sm:text-xs">
                          {t(`auditLogs.actions.${item.action}`, {
                            defaultValue: item.action,
                          })}
                        </span>
                        <span className="mx-2 mt-1 block truncate text-xs text-ink-mute sm:hidden">
                          {item.actorName || item.actorEmail}
                          {item.targetLabel
                            ? `${t("auditLogs.detailSeparator")}${item.targetLabel}`
                            : ""}
                        </span>
                      </span>
                      <span className="hidden min-w-0 sm:block">
                        <span className="block truncate text-xs text-ink">
                          {item.actorName || item.actorEmail}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-mute">
                          {item.actorEmail}
                        </span>
                      </span>
                      <span className="hidden min-w-0 sm:block">
                        <span className="block truncate text-xs text-ink">
                          {item.targetLabel || "—"}
                        </span>
                        {detail && (
                          <span className="mt-0.5 block truncate text-xs text-ink-mute">
                            {detail}
                          </span>
                        )}
                      </span>
                      <span className="text-right text-xs text-ink-mute">
                        {dateFormatter.format(new Date(item.createdAt))}
                      </span>
                    </div>
                  );
                })}
              </div>
              {hasNextPage && (
                <InfiniteScrollSentinel onLoadMore={loadMore} rows={2} />
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
