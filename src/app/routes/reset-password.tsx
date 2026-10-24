import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth/client";
import { LogoMark } from "@/components/ui/LogoMark";

export default function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const token = searchParams.get("token");
  const hasInvalidToken = searchParams.get("error") === "INVALID_TOKEN" || !token;

  const callbackUrl = useMemo(() => {
    const value = searchParams.get("callbackUrl");
    // ブラウザは \ を / と読み、タブや改行を捨てるので、それらを含む値は外部への移動になりうる
    return value && /^\/(?![/\\])[^\\\p{Cc}]*$/u.test(value) ? value : "/app";
  }, [searchParams]);

  const loginUrl = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const forgotPasswordUrl = `/forgot-password?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || !token) return;

    const formData = new FormData(event.currentTarget);
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (newPassword.length < 8) {
      toast.error(t("auth.resetPassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("auth.resetPassword.passwordMismatch"));
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await authClient.resetPassword({
        newPassword,
        token,
      });
      if (error) {
        toast.error(t("auth.resetPassword.invalidTokenError"));
        return;
      }
      setIsComplete(true);
    } catch (error) {
      console.error(error);
      toast.error(t("auth.resetPassword.resetError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink antialiased">
      <header className="fixed inset-x-0 top-0 z-20 h-16">
        <div className="ui-container flex h-16 items-center">
          <Link to="/" className="flex items-center gap-1">
            <LogoMark />
            <span className="text-lg font-bold tracking-tight">Forkline</span>
          </Link>
        </div>
      </header>
      <main
        className="relative flex min-h-dvh items-center overflow-hidden px-4 py-24"
        style={{
          backgroundImage:
            "radial-gradient(120% 110% at 45% 100%, color-mix(in srgb, var(--color-brand) 30%, var(--color-canvas)) 0%, color-mix(in srgb, var(--color-brand) 12%, var(--color-canvas)) 40%, var(--color-canvas) 100%)",
        }}
      >
        <div className="ui-card relative mx-auto w-full max-w-lg p-2">
          <div className="rounded-xl bg-paper p-6 sm:p-8">
            {isComplete ? (
              <div className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
                  <CircleCheck className="h-4 w-4" />
                </span>
                <h1 className="mt-5 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                  {t("auth.resetPassword.completeTitle")}
                </h1>
                <p className="mt-3 text-sm leading-6 text-ink-mute">
                  {t("auth.resetPassword.completeDescription")}
                </p>
                <Link className="ui-button-primary mt-7 w-full" to={loginUrl}>
                  {t("auth.resetPassword.goToLogin")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : hasInvalidToken ? (
              <div className="text-center">
                <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                  {t("auth.resetPassword.invalidLinkTitle")}
                </h1>
                <p className="mt-3 text-sm leading-6 text-ink-mute">
                  {t("auth.resetPassword.invalidLinkDescription")}
                </p>
                <Link className="ui-button-primary mt-7 w-full" to={forgotPasswordUrl}>
                  {t("auth.resetPassword.requestNewLink")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                  {t("auth.resetPassword.title")}
                </h1>
                <p className="mt-2 text-sm leading-6 text-ink-mute">
                  {t("auth.resetPassword.description")}
                </p>
                <form className="mt-7 grid gap-5" onSubmit={handleSubmit}>
                  <label className="grid gap-2 text-sm text-ink">
                    {t("auth.resetPassword.newPasswordLabel")}
                    <input
                      className="ui-input"
                      name="newPassword"
                      type="password"
                      autoComplete="new-password"
                      placeholder={t("auth.resetPassword.passwordPlaceholder")}
                      minLength={8}
                      required
                      autoFocus
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-ink">
                    {t("auth.resetPassword.confirmPasswordLabel")}
                    <input
                      className="ui-input"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      placeholder={t("auth.resetPassword.confirmPasswordPlaceholder")}
                      minLength={8}
                      required
                    />
                  </label>
                  <button
                    className="ui-button-primary mt-1 w-full"
                    type="submit"
                    disabled={isLoading}
                  >
                    {isLoading
                      ? t("auth.resetPassword.updating")
                      : t("auth.resetPassword.submitButton")}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              </>
            )}
            {!isComplete && (
              <Link
                className="mt-7 flex items-center justify-center gap-2 text-sm font-semibold text-ink-mute hover:text-ink"
                to={loginUrl}
              >
                <ArrowLeft className="h-4 w-4" />
                {t("auth.backToLogin")}
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
