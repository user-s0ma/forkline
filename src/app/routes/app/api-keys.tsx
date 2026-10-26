import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CopyButton,
  PanelHeader,
} from "@/components/account/shared";
import {
  useDateFormatter,
  useErrorToast,
  useAccountPage,
} from "@/components/account/hooks";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { Modal } from "@/components/ui/Modal";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyRecord,
} from "@/lib/api-client";
import { useConfirm } from "@/components/ui/useConfirm";

const API_BASE = "https://forkline.ai/v1";

export default function ApiKeysPage() {
  const { t } = useTranslation();
  const [confirm, confirmDialog] = useConfirm();
  const { openMobileNavigation } = useAccountPage();
  const dateFormatter = useDateFormatter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data, error, isPending } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => listApiKeys(),
  });
  useErrorToast(error, t("apiKeys.loadFailed"));
  const keys = data?.items ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["api-keys"] });

  const openCreate = () => {
    setName("");
    setCreateOpen(true);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const created = await createApiKey(name.trim());
      setCreateOpen(false);
      setCreatedKey(created.key);
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("apiKeys.createFailed"),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKeyRecord) => {
    if (!(await confirm(t("apiKeys.revokeConfirm", { name: key.name }), { danger: true }))) return;
    try {
      await revokeApiKey(key.id);
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("apiKeys.revokeFailed"),
      );
    }
  };

  const snippet = [
    `curl ${API_BASE}/chat/completions \\`,
    `  -H "Authorization: Bearer fk_..." \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model": "<model-id>", "messages": [{"role": "user", "content": "Hello"}]}'`,
  ].join("\n");

  return (
    <>
      {confirmDialog}
      <PageHeader
        title={t("apiKeys.title")}
        description={t("apiKeys.description")}
        onOpenMenu={openMobileNavigation}
        actions={
          <button
            className="console-button-primary"
            type="button"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            {t("apiKeys.create")}
          </button>
        }
      />
      <PageBody>
        <section className="console-panel overflow-hidden">
          {isPending ? (
            <ListSkeleton rows={3} />
          ) : keys.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title={t("apiKeys.emptyTitle")}
              action={
                <button
                  className="console-button-primary"
                  type="button"
                  onClick={openCreate}
                >
                  {t("apiKeys.createFirst")}
                </button>
              }
            />
          ) : (
            <table className="console-table table-fixed">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th className="hidden w-40 sm:table-cell">
                    {t("apiKeys.key")}
                  </th>
                  <th className="hidden w-48 md:table-cell">
                    {t("apiKeys.lastUsed")}
                  </th>
                  <th className="hidden w-48 lg:table-cell">
                    {t("apiKeys.createdAt")}
                  </th>
                  <th className="w-28">
                    <span className="sr-only">{t("apiKeys.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="transition-colors hover:bg-paper">
                    <td className="min-w-0">
                      <div className="min-w-0">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{key.name}</span>
                          <span className="mt-1 block font-mono text-xs text-ink-mute sm:hidden">
                            {key.prefix}…
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="hidden font-mono text-xs text-ink-soft sm:table-cell">
                      {key.prefix}…
                    </td>
                    <td className="num hidden text-ink-mute md:table-cell">
                      {key.lastUsedAt ? (
                        dateFormatter.format(new Date(key.lastUsedAt))
                      ) : (
                        <Badge>{t("apiKeys.neverUsed")}</Badge>
                      )}
                    </td>
                    <td className="num hidden text-ink-mute lg:table-cell">
                      {dateFormatter.format(new Date(key.createdAt))}
                    </td>
                    <td className="text-right">
                      <button
                        className="rounded-(--radius-control) px-2 py-1 text-sm text-danger hover:bg-danger-tint"
                        type="button"
                        aria-label={t("apiKeys.revokeAria", { name: key.name })}
                        onClick={() => void handleRevoke(key)}
                      >
                        {t("apiKeys.revoke")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="console-panel">
          <PanelHeader
            title={t("apiKeys.quickstartTitle")}
            action={
              <a className="text-brand-ink hover:underline" href="/docs">
                {t("apiKeys.docsLink")}
              </a>
            }
          />
          <div className="space-y-3 p-4 sm:p-5">
            <pre className="overflow-x-auto rounded-(--radius-control) border border-line bg-code p-4 font-mono text-xs leading-6 text-code-ink">
              <code>{snippet}</code>
            </pre>
          </div>
        </section>

        {createOpen && (
          <Modal
            title={t("apiKeys.createTitle")}
            onClose={() => setCreateOpen(false)}
          >
            <form className="space-y-4 p-5" onSubmit={handleCreate}>
              <label className="block">
                <span className="console-label">{t("common.name")}</span>
                <input
                  className="console-input"
                  value={name}
                  maxLength={80}
                  autoFocus
                  placeholder={t("apiKeys.namePlaceholder")}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="console-button-secondary"
                  type="button"
                  onClick={() => setCreateOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="console-button-primary"
                  type="submit"
                  disabled={!name.trim() || isCreating}
                >
                  {isCreating ? t("common.creating") : t("apiKeys.create")}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {createdKey && (
          <Modal
            title={t("apiKeys.createdTitle")}
            onClose={() => setCreatedKey(null)}
          >
            <div className="space-y-4 p-5">
              <p className="rounded-(--radius-control) bg-signal-tint px-3 py-2.5 text-sm leading-6 text-signal">
                {t("apiKeys.createdWarning")}
              </p>
              <div className="flex gap-2">
                <input
                  className="console-input font-mono text-xs!"
                  value={createdKey}
                  readOnly
                  aria-label={t("apiKeys.key")}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton value={createdKey} />
              </div>
              <div className="flex justify-end">
                <button
                  className="console-button-primary"
                  type="button"
                  onClick={() => setCreatedKey(null)}
                >
                  {t("apiKeys.createdDone")}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </PageBody>
    </>
  );
}
