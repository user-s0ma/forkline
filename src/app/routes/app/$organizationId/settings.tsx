import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Menu, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Route } from "./+types/settings";
import { ConsoleSelect } from "@/components/ui/ConsoleSelect";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { Modal } from "@/components/ui/Modal";
import { authClient } from "@/lib/auth/client";
import { localeTag, useLocale } from "@/lib/i18n";
import type { AppLayoutContext } from "../_layout";
import { useConfirm } from "@/components/ui/useConfirm";

type OrganizationMemberDetail = {
  id: string;
  userId: string;
  role: string;
  user: { name: string; email: string };
};

type OrganizationDetail = {
  id: string;
  name: string;
  createdAt: string | Date;
  members: OrganizationMemberDetail[];
};

export default function OrganizationSettingsPage({
  params,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const [confirm, confirmDialog] = useConfirm();
  const locale = useLocale();
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const navigate = useNavigate();
  const {
    user,
    organizations,
    isOrganizationsLoading,
    refreshOrganizations,
    openMobileNavigation,
  } = useOutletContext<AppLayoutContext>();
  const queryClient = useQueryClient();
  const [nameInput, setNameInput] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  const organization = organizations.find(
    (item) => item.id === params.organizationId,
  );

  const { data, error, isPending } = useQuery({
    queryKey: ["organization-settings", params.organizationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization(
        { query: { organizationId: params.organizationId } },
      );
      if (error) throw new Error(error.message);
      return data as unknown as OrganizationDetail;
    },
    enabled: !isOrganizationsLoading && Boolean(organization),
  });

  const currentRole = data?.members.find(
    (member) => member.userId === user.id,
  )?.role;
  const isOwner = currentRole === "owner";
  const memberCount = data?.members.length ?? 0;
  const name = nameInput ?? data?.name ?? "";
  const selfMemberId =
    data?.members.find((member) => member.userId === user.id)?.id ?? null;
  const otherMembers = (data?.members ?? []).filter(
    (member) =>
      member.userId !== user.id &&
      member.role
        .split(",")
        .map((role) => role.trim())
        .includes("admin"),
  );
  const memberOptions = otherMembers.map((member) => ({
    value: member.id,
    label: member.user?.name || member.user?.email || member.userId,
  }));

  useEffect(() => {
    if (!error) return;
    console.error(error);
    toast.error(
      error instanceof Error ? error.message : t("settings.loadFailed"),
    );
  }, [error, t]);

  useEffect(() => {
    if (isOrganizationsLoading) return;
    if (!organization) navigate("/app", { replace: true });
  }, [isOrganizationsLoading, navigate, organization]);

  const trimmedName = name.trim();
  const canSave =
    data !== undefined && Boolean(trimmedName) && trimmedName !== data.name;

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || isSaving || !data) return;
    setIsSaving(true);
    try {
      const { error } = await authClient.organization.update({
        organizationId: params.organizationId,
        data: { name: trimmedName },
      });
      if (error) throw new Error(error.message);
      setNameInput(null);
      await Promise.all([
        refreshOrganizations(),
        queryClient.invalidateQueries({
          queryKey: ["organization-settings", params.organizationId],
        }),
      ]);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("settings.updateFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTransfer = async () => {
    if (!isOwner || isTransferring || isDeleting || !selfMemberId) return;
    const target = otherMembers.find((member) => member.id === transferTarget);
    if (!target) return;
    const label = target.user?.name || target.user?.email || "";
    if (!(await confirm(t("settings.transferConfirm", { name: label }), { danger: true }))) return;
    setIsTransferring(true);
    try {
      const promote = await authClient.organization.updateMemberRole({
        memberId: target.id,
        role: "owner",
        organizationId: params.organizationId,
      });
      if (promote.error) throw new Error(promote.error.message);
      const demote = await authClient.organization.updateMemberRole({
        memberId: selfMemberId,
        role: "admin",
        organizationId: params.organizationId,
      });
      if (demote.error) throw new Error(demote.error.message);
      setTransferTarget("");
      await Promise.all([
        refreshOrganizations(),
        queryClient.invalidateQueries({
          queryKey: ["organization-settings", params.organizationId],
        }),
      ]);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("settings.transferFailed"),
      );
    } finally {
      setIsTransferring(false);
    }
  };

  const handleDelete = async () => {
    if (!isOwner || !data || isDeleting || isTransferring) return;
    if (deleteConfirmInput.trim() !== data.name) return;
    setIsDeleting(true);
    try {
      const { error } = await authClient.organization.delete({
        organizationId: params.organizationId,
      });
      if (error) throw new Error(error.message);
      toast.success(t("settings.deleteSuccess"));
      await refreshOrganizations();
      navigate("/app", { replace: true });
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("settings.deleteFailed"),
      );
      setIsDeleting(false);
    }
  };

  return (
    <>
      {confirmDialog}
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
              {t("common.settings")}
            </span>
          </div>
        </div>
      </header>
      <main className="w-full">
        {isPending || !data ? (
          <ListSkeleton />
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
            <section className="console-panel overflow-hidden">
              <div className="border-b border-line bg-paper p-4 rounded-t-xl">
                <h2 className="text-sm font-semibold">
                  {t("settings.organizationInfo")}
                </h2>
              </div>
              <form className="space-y-4 p-5" onSubmit={handleSave}>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink">
                    {t("settings.organizationName")}
                  </span>
                  <input
                    className="console-input"
                    value={name}
                    maxLength={191}
                    disabled={!isOwner}
                    onChange={(event) => setNameInput(event.target.value)}
                  />
                </label>
                {isOwner ? (
                  <div className="flex justify-end pt-1">
                    <button
                      className="console-button-primary"
                      type="submit"
                      disabled={!canSave || isSaving}
                    >
                      {isSaving
                        ? t("settings.saving")
                        : t("settings.saveChanges")}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-ink-mute">
                    {t("settings.ownerOnlyNotice")}
                  </p>
                )}
              </form>
            </section>

            <section className="console-panel overflow-hidden">
              <div className="border-b border-line bg-paper p-4 rounded-t-xl">
                <h2 className="text-sm font-semibold">
                  {t("settings.details")}
                </h2>
              </div>
              <dl className="divide-y divide-line text-sm">
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <dt className="text-xs text-ink-mute">
                    {t("settings.memberCount")}
                  </dt>
                  <dd className="text-xs text-ink">
                    {t("settings.memberCountValue", { count: memberCount })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <dt className="text-xs text-ink-mute">
                    {t("settings.createdAt")}
                  </dt>
                  <dd className="text-xs text-ink">
                    {dateFormatter.format(new Date(data.createdAt))}
                  </dd>
                </div>
              </dl>
            </section>

            {isOwner && (
              <section className="console-panel overflow-hidden">
                <div className="border-b border-line bg-danger-tint p-4 rounded-t-xl">
                  <h2 className="text-sm font-semibold text-danger">
                    {t("settings.dangerZone")}
                  </h2>
                </div>
                <div className="divide-y divide-line">
                  <div className="p-5">
                    <p className="text-sm text-ink">
                      {t("settings.transferTitle")}
                    </p>
                    <p className="mt-1 text-xs text-ink-mute">
                      {t("settings.transferDescription")}
                    </p>
                    {memberOptions.length === 0 ? (
                      <p className="mt-3 text-xs text-ink-mute">
                        {t("settings.transferNoMembers")}
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="sm:flex-1">
                          <ConsoleSelect
                            value={transferTarget}
                            options={[
                              {
                                value: "",
                                label: t("settings.transferSelectPlaceholder"),
                              },
                              ...memberOptions,
                            ]}
                            disabled={isTransferring || isDeleting}
                            ariaLabel={t("settings.transferTitle")}
                            onChange={(value) => setTransferTarget(value)}
                          />
                        </div>
                        <button
                          className="console-button-secondary shrink-0"
                          type="button"
                          disabled={
                            !transferTarget || isTransferring || isDeleting
                          }
                          onClick={handleTransfer}
                        >
                          <ArrowLeftRight className="h-4 w-4" />
                          {isTransferring
                            ? t("common.processing")
                            : t("settings.transferButton")}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-ink">
                        {t("settings.deleteTitle")}
                      </p>
                      <p className="mt-1 text-xs text-ink-mute">
                        {t("settings.deleteDescription")}
                      </p>
                    </div>
                    <button
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-danger/50 px-4 text-sm font-semibold text-danger transition-colors hover:bg-danger-tint disabled:opacity-50"
                      type="button"
                      disabled={isTransferring}
                      onClick={() => {
                        setDeleteConfirmInput("");
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("settings.deleteButton")}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {isOwner && deleteOpen && (
              <Modal
                title={t("settings.deleteTitle")}
                onClose={() => {
                  if (!isDeleting) setDeleteOpen(false);
                }}
              >
                <form
                  className="space-y-4 p-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleDelete();
                  }}
                >
                  <p className="text-sm leading-relaxed text-ink-mute">
                    {t("settings.deleteDescription")}
                  </p>
                  <label className="block">
                    <span className="mb-1 block text-xs text-ink">
                      {t("settings.deleteConfirmPrompt", { name: data.name })}
                    </span>
                    <input
                      className="console-input"
                      type="text"
                      value={deleteConfirmInput}
                      autoFocus
                      autoComplete="off"
                      placeholder={data.name}
                      onChange={(event) =>
                        setDeleteConfirmInput(event.target.value)
                      }
                    />
                  </label>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-danger px-4 text-sm font-semibold text-on-danger transition-colors hover:bg-danger/85 disabled:opacity-50"
                      type="submit"
                      disabled={
                        deleteConfirmInput.trim() !== data.name || isDeleting
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                      {isDeleting
                        ? t("common.processing")
                        : t("settings.deleteButton")}
                    </button>
                  </div>
                </form>
              </Modal>
            )}
          </div>
        )}
      </main>
    </>
  );
}
