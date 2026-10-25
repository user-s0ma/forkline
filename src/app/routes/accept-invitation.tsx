import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { redirect, useNavigate } from "react-router";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/accept-invitation";
import { auth } from "@/lib/auth/server";
import { authClient } from "@/lib/auth/client";
import { appContext } from "@/lib/util/app-context";
import { LogoMark } from "@/components/ui/LogoMark";

type InvitationDetail = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string | Date;
  organizationId: string;
  organizationName?: string;
  inviterEmail?: string;
};

const ROLE_KEYS: Record<string, string> = {
  owner: "common.roles.owner",
  admin: "common.roles.admin",
  member: "common.roles.member",
};

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const session = await auth(env, new URL(request.url).origin).api.getSession({
    headers: request.headers,
  });
  if (!session) {
    const callbackUrl = encodeURIComponent(
      `/accept-invitation/${params.invitationId}`,
    );
    throw redirect(`/login?callbackUrl=${callbackUrl}`);
  }
  return { invitationId: params.invitationId };
}

export default function AcceptInvitationPage({
  loaderData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ["invitation", loaderData.invitationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({
        query: { id: loaderData.invitationId },
      });
      if (error) throw new Error(error.message);
      const invitation = data as unknown as InvitationDetail;
      return {
        ...invitation,
        isExpired: new Date(invitation.expiresAt).getTime() <= Date.now(),
      };
    },
    retry: false,
  });

  const isExpired = data?.isExpired ?? false;
  const isPendingInvitation = data?.status === "pending" && !isExpired;

  const handleAccept = async () => {
    if (!data || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { error } = await authClient.organization.acceptInvitation({
        invitationId: loaderData.invitationId,
      });
      if (error) throw new Error(error.message);
      await authClient.organization.setActive({
        organizationId: data.organizationId,
      });
      navigate(`/app/${encodeURIComponent(data.organizationId)}/`, {
        replace: true,
      });
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth.invitation.acceptError"),
      );
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { error } = await authClient.organization.rejectInvitation({
        invitationId: loaderData.invitationId,
      });
      if (error) throw new Error(error.message);
      navigate("/app", { replace: true });
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth.invitation.declineError"),
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 font-sans antialiased">
      <div className="ui-card w-full max-w-md p-8 text-center">
        <div className="flex items-center justify-center gap-1">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight">Forkline</span>
        </div>
        {isPending ? (
          <p className="mt-8 text-sm text-ink-mute">
            {t("auth.invitation.checking")}
          </p>
        ) : error || !data ? (
          <>
            <h1 className="mt-8 text-xl font-semibold">
              {t("auth.invitation.notFoundTitle")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-mute">
              {t("auth.invitation.notFoundDescription")}
            </p>
            <button
              className="ui-button-secondary mt-8 w-full"
              type="button"
              onClick={() => navigate("/app")}
            >
              {t("auth.invitation.backToApp")}
            </button>
          </>
        ) : !isPendingInvitation ? (
          <>
            <h1 className="mt-8 text-xl font-semibold">
              {t("auth.invitation.unavailableTitle")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-mute">
              {isExpired
                ? t("auth.invitation.expiredDescription")
                : t("auth.invitation.usedDescription")}
            </p>
            <button
              className="ui-button-secondary mt-8 w-full"
              type="button"
              onClick={() => navigate("/app")}
            >
              {t("auth.invitation.backToApp")}
            </button>
          </>
        ) : (
          <>
            <span className="mx-auto mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
              <Building2 className="h-6 w-6" />
            </span>
            <h1 className="mt-5 text-xl font-semibold">
              {t("auth.invitation.title", {
                organization:
                  data.organizationName ||
                  t("auth.invitation.organizationFallback"),
              })}
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-mute">
              {t(
                data.inviterEmail
                  ? "auth.invitation.descriptionWithInviter"
                  : "auth.invitation.description",
                {
                  inviter: data.inviterEmail,
                  role: ROLE_KEYS[data.role || "member"]
                    ? t(ROLE_KEYS[data.role || "member"])
                    : data.role,
                },
              )}
            </p>
            <div className="mt-8 space-y-2">
              <button
                className="ui-button-primary w-full"
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleAccept()}
              >
                {isSubmitting
                  ? t("auth.processing")
                  : t("auth.invitation.acceptButton")}
              </button>
              <button
                className="ui-button-secondary w-full"
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleReject()}
              >
                {t("auth.invitation.declineButton")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
