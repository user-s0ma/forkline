import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuthTurnstile } from "@/lib/auth/use-auth-turnstile";

/** お試しの共有アカウントに入るボタン (登録なし)。Turnstile を通ってから入る */
export function DemoButton({ className = "ui-button-primary" }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { captchaWidget, captchaHeaders, resetCaptcha } = useAuthTurnstile();
  const [isLoading, setIsLoading] = useState(false);

  const signInDemo = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/sign-in/demo", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(await captchaHeaders()) },
        body: "{}",
      });
      if (!response.ok) {
        toast.error(t("auth.login.demoError"));
        return;
      }
      // 同じタブで前にログインしていた人のデータを見せない
      queryClient.clear();
      navigate("/app/models", { replace: true });
    } catch (error) {
      console.error(error);
      toast.error(t("auth.login.demoError"));
    } finally {
      resetCaptcha();
      setIsLoading(false);
    }
  };

  return (
    <>
      <button className={className} type="button" disabled={isLoading} onClick={() => void signInDemo()}>
        {isLoading ? t("auth.login.demoOpening") : t("auth.login.tryDemo")}
      </button>
      {captchaWidget}
    </>
  );
}
