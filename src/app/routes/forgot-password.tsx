import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth/client";
import {
  isCaptchaError,
  useAuthTurnstile,
} from "@/lib/auth/use-auth-turnstile";
import { LogoMark } from "@/components/ui/LogoMark";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { captchaWidget, captchaHeaders, resetCaptcha } = useAuthTurnstile();

  const callbackUrl = useMemo(() => {
    const value = searchParams.get("callbackUrl");
    // ブラウザは \ を / と読み、タブや改行を捨てるので、それらを含む値は外部への移動になりうる
    return value && /^\/(?![/\\])[^\\\p{Cc}]*$/u.test(value) ? value : "/app";
  }, [searchParams]);

  const loginUrl = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    setIsLoading(true);

    try {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: `/reset-password?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        fetchOptions: { headers: await captchaHeaders() },
      });
      if (error) {
        toast.error(
          isCaptchaError(error)
            ? t("auth.captchaFailed")
            : t("auth.forgotPassword.sendError"),
        );
        return;
      }
      setSentTo(email);
    } catch (error) {
      console.error(error);
      toast.error(t("auth.forgotPassword.sendError"));
    } finally {
      resetCaptcha();
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink antialiased">
      <header className="fixed inset-x-0 top-0 z-20 h-16">
        <div className="ui-container flex h-16 items-center">
          <Link to="/" className="flex items-center gap-1">
            <LogoMark />
            <span className="text-lg font-bold tracking-tight">
              Forkline
            </span>
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
            {sentTo ? (
              <div className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
                  <MailCheck className="h-4 w-4" />
                </span>
                <h1 className="mt-5 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                  {t("auth.forgotPassword.checkEmailTitle")}
                </h1>
                <p className="mt-3 break-all text-sm leading-6 text-ink-mute">
                  {t("auth.forgotPassword.sentDescription", { email: sentTo })}
                </p>
                <button
                  className="mt-6 text-sm font-semibold text-brand-ink hover:underline"
                  type="button"
                  onClick={() => setSentTo(null)}
                >
                  {t("auth.forgotPassword.useDifferentEmail")}
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                  {t("auth.forgotPassword.title")}
                </h1>
                <p className="mt-2 text-sm leading-6 text-ink-mute">
                  {t("auth.forgotPassword.description")}
                </p>
                <form className="mt-7 grid gap-5" onSubmit={handleSubmit}>
                  <label className="grid gap-2 text-sm text-ink">
                    {t("common.email")}
                    <input
                      className="ui-input"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder={t("auth.forgotPassword.emailPlaceholder")}
                      required
                      autoFocus
                    />
                  </label>
                  <button
                    className="ui-button-primary mt-1 w-full"
                    type="submit"
                    disabled={isLoading}
                  >
                    {isLoading
                      ? t("common.sending")
                      : t("auth.forgotPassword.sendButton")}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  {captchaWidget}
                </form>
              </>
            )}
            <Link
              className="mt-7 flex items-center justify-center gap-2 text-sm font-semibold text-ink-mute hover:text-ink"
              to={loginUrl}
            >
              <ArrowLeft className="h-4 w-4" />
              {t("auth.backToLogin")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
