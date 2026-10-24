import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { Building2, Menu, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { Modal } from "@/components/ui/Modal";
import { authClient } from "@/lib/auth/client";
import { toSlug } from "@/lib/organization/slug";
import type { AppLayoutContext } from "./_layout";

export default function OrganizationRedirect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    organizations,
    isOrganizationsLoading,
    activeOrganizationId,
    refreshOrganizations,
    openMobileNavigation,
  } = useOutletContext<AppLayoutContext>();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (isOrganizationsLoading || organizations.length === 0) return;
    const target =
      organizations.find(
        (organization) => organization.id === activeOrganizationId,
      ) ?? organizations[0];
    navigate(`/app/${encodeURIComponent(target.id)}/`, { replace: true });
  }, [activeOrganizationId, isOrganizationsLoading, navigate, organizations]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    try {
      const { data, error } = await authClient.organization.create({
        name: trimmed,
        slug: toSlug(trimmed),
      });
      if (error) throw new Error(error.message);
      if (data?.id) {
        navigate(`/app/${encodeURIComponent(data.id)}/`, { replace: true });
      }
      void refreshOrganizations();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("appShell.createOrganizationFailed"),
      );
      setIsCreating(false);
    }
  };

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
          </div>
        </div>
      </header>
      <main className="w-full">
        {!isOrganizationsLoading && organizations.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t("appShell.noOrganizationsTitle")}
            description={t("appShell.noOrganizationsDescription")}
            action={
              <button
                className="console-button-primary"
                type="button"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-4 w-4" />
                {t("appShell.createOrganization")}
              </button>
            }
          />
        ) : (
          <ListSkeleton />
        )}
      </main>
      {createOpen && (
        <Modal
          title={t("appShell.createOrganization")}
          onClose={() => setCreateOpen(false)}
        >
          <form className="space-y-4 p-5" onSubmit={handleCreate}>
            <label className="block">
              <span className="mb-1 block text-xs text-ink">
                {t("settings.organizationName")}
              </span>
              <input
                className="console-input"
                type="text"
                value={name}
                maxLength={120}
                autoFocus
                placeholder={t("appShell.organizationNamePlaceholder")}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                className="console-button-primary"
                type="submit"
                disabled={!name.trim() || isCreating}
              >
                {isCreating ? t("common.creating") : t("common.create")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
