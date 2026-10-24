import { useCallback, useRef } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

const SITE_KEY = import.meta.env.VITE_PUBLIC_TURNSTILE_SITE_KEY;
const CAPTCHA_ERROR_CODES = new Set([
  "VERIFICATION_FAILED",
  "MISSING_RESPONSE",
]);

export function isCaptchaError(error: { code?: string }) {
  return CAPTCHA_ERROR_CODES.has(error.code ?? "");
}

/** ログインまわりの送信に付ける Turnstile。トークンは1回しか使えないので、送るたびに作り直す */
export function useAuthTurnstile() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ref = useRef<TurnstileInstance | null>(null);

  const captchaHeaders = useCallback(async (): Promise<Record<string, string>> => {
    // サイトキーが空のとき (手元の開発) は Turnstile を使わない。サーバー側も外れている
    if (!SITE_KEY) return {};
    const turnstile = ref.current;
    if (!turnstile) throw new Error(t("auth.captchaPreparing"));
    if (turnstile.isExpired()) turnstile.reset();
    const token =
      turnstile.getResponse() ||
      (await turnstile.getResponsePromise(15_000, 100));
    return { "x-captcha-response": token };
  }, [t]);

  const resetCaptcha = useCallback(() => ref.current?.reset(), []);

  const captchaWidget = SITE_KEY ? (
    <Turnstile
      ref={ref}
      siteKey={SITE_KEY}
      options={{
        appearance: "interaction-only",
        language: locale,
        responseField: false,
        refreshExpired: "auto",
        refreshTimeout: "auto",
      }}
      onError={() => toast.error(t("auth.captchaFailed"))}
      className="flex justify-center"
    />
  ) : null;

  return { captchaWidget, captchaHeaders, resetCaptcha };
}
