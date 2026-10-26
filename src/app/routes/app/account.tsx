import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LogOut, Menu, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { authClient } from "@/lib/auth/client";
import type { AppLayoutContext } from "./_layout";

function SectionHeader({ title, danger }: { title: string; danger?: boolean }) {
  return (
    <div
      className={`border-b border-line p-4 rounded-t-xl ${
        danger ? "bg-danger-tint" : "bg-paper"
      }`}
    >
      <h2 className={`text-sm font-semibold ${danger ? "text-danger" : ""}`}>
        {title}
      </h2>
    </div>
  );
}

export default function AccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, openMobileNavigation, setUserName } =
    useOutletContext<AppLayoutContext>();

  const [name, setName] = useState(user.name);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const busy = isSaving || isSigningOut || isDeleting;
  const trimmedName = name.trim();
  const canSave = Boolean(trimmedName) && trimmedName !== user.name;

  const fail = (error: unknown, fallback: string) => {
    console.error(error);
    toast.error(error instanceof Error ? error.message : fallback);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || busy) return;
    setIsSaving(true);
    try {
      const { error } = await authClient.updateUser({ name: trimmedName });
      if (error) throw new Error(error.message);
      setUserName(trimmedName);
      toast.success(t("account.saved"));
    } catch (error) {
      fail(error, t("appShell.profileModal.updateFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    if (busy) return;
    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message);
      // 同じタブで次の人がログインしたとき、前の人のデータを見せない
      queryClient.clear();
      navigate("/login", { replace: true });
    } catch (error) {
      fail(error, t("appShell.profileModal.signOutFailed"));
      setIsSigningOut(false);
    }
  };

  const handleDelete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmEmail.trim() !== user.email || busy) return;
    setIsDeleting(true);
    try {
      const { error } = await authClient.deleteUser();
      if (error) {
        // 最後のログインから時間が経っていると消せない（better-auth の決まり）
        throw new Error(
          error.code === "SESSION_EXPIRED"
            ? t("account.deleteNeedsSignIn")
            : (error.message ?? t("account.deleteFailed")),
        );
      }
      toast.success(t("account.deleted"));
      navigate("/", { replace: true });
    } catch (error) {
      fail(error, t("account.deleteFailed"));
      setIsDeleting(false);
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
            <span className="truncate text-sm mx-2">{t("account.title")}</span>
          </div>
        </div>
      </header>
      <main className="w-full">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          <section className="console-panel overflow-hidden">
            <SectionHeader title={t("appShell.profile")} />
            <form className="space-y-4 p-5" onSubmit={handleSave}>
              <label className="block">
                <span className="mb-1 block text-xs text-ink">
                  {t("common.name")}
                </span>
                <input
                  className="console-input"
                  value={name}
                  maxLength={191}
                  onChange={(event) => setName(event.target.value)}
                />
                <span className="mt-1.5 block text-xs leading-5 text-ink-mute">
                  {t("account.nameHint")}
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink">
                  {t("common.email")}
                </span>
                <input
                  className="console-input disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-mute"
                  value={user.email}
                  disabled
                />
                <span className="mt-1.5 block text-xs leading-5 text-ink-mute">
                  {t("appShell.profileModal.emailHint")}
                </span>
              </label>
              <div>
                <span className="mb-1 block text-xs text-ink">
                  {t("appShell.profileModal.language")}
                </span>
                <LanguageSwitcher className="w-full" />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  className="console-button-primary"
                  type="submit"
                  disabled={!canSave || busy}
                >
                  {isSaving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </section>

          <button
            className="console-panel flex w-full items-center justify-center gap-2 px-3 py-3 text-sm text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-50"
            type="button"
            onClick={handleSignOut}
            disabled={busy}
          >
            <LogOut className="h-4 w-4" />
            {isSigningOut
              ? t("appShell.profileModal.signingOut")
              : t("common.logout")}
          </button>

          <section id="delete" className="console-panel overflow-hidden">
            <SectionHeader title={t("account.deleteTitle")} danger />
            <form className="space-y-4 p-5" onSubmit={handleDelete}>
              <p className="text-sm leading-6 text-ink">
                {t("account.deleteDescription")}
              </p>
              <label className="block">
                <span className="mb-1 block text-xs text-ink">
                  {t("account.deleteConfirmPrompt")}
                </span>
                <input
                  className="console-input"
                  type="email"
                  value={confirmEmail}
                  autoComplete="off"
                  placeholder={user.email}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                />
              </label>
              <div className="flex justify-end">
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-danger px-4 text-sm font-semibold text-on-danger transition-colors hover:bg-danger/85 disabled:opacity-50"
                  type="submit"
                  disabled={confirmEmail.trim() !== user.email || busy}
                >
                  <Trash2 className="h-4 w-4" />
                  {isDeleting ? t("common.processing") : t("account.deleteButton")}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
