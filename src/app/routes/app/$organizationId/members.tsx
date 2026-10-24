import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { LogOut, Mail, Menu, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import type { Route } from "./+types/members";
import { ConsoleSelect } from "@/components/ui/ConsoleSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { Modal } from "@/components/ui/Modal";
import { authClient } from "@/lib/auth/client";
import { localeTag, useLocale } from "@/lib/i18n";
import type { AppLayoutContext } from "../_layout";

type MemberRole = "owner" | "admin" | "member";

type OrganizationMember = {
  id: string;
  userId: string;
  role: string;
  createdAt: string | Date;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
};

type OrganizationInvitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string | Date;
};

export default function MembersPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const roleLabel = (role: string) =>
    t(`common.roles.${role}`, { defaultValue: role });
  const navigate = useNavigate();
  const {
    user,
    organizations,
    isOrganizationsLoading,
    refreshOrganizations,
    openMobileNavigation,
  } = useOutletContext<AppLayoutContext>();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const organization = organizations.find(
    (item) => item.id === params.organizationId,
  );

  const { data, error, isPending } = useQuery({
    queryKey: ["organization-members", params.organizationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization(
        { query: { organizationId: params.organizationId } },
      );
      if (error) throw new Error(error.message);
      const organization = data as unknown as {
        members: OrganizationMember[];
        invitations: OrganizationInvitation[];
      };
      return {
        members: organization.members,
        pendingInvitations: organization.invitations.filter(
          (invitation) =>
            invitation.status === "pending" &&
            new Date(invitation.expiresAt).getTime() > Date.now(),
        ),
      };
    },
    enabled: !isOrganizationsLoading && Boolean(organization),
  });

  const members = data?.members ?? [];
  const pendingInvitations = data?.pendingInvitations ?? [];

  const currentMember = members.find((member) => member.userId === user.id);
  const isOwner = currentMember?.role === "owner";
  const canManage = isOwner || currentMember?.role === "admin";
  const assignableRoles: MemberRole[] = ["admin", "member"];
  const roleOptions = useMemo(
    () =>
      assignableRoles.map((role) => ({ value: role, label: roleLabel(role) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  useEffect(() => {
    if (!error) return;
    console.error(error);
    toast.error(
      error instanceof Error ? error.message : t("members.loadFailed"),
    );
  }, [error, t]);

  useEffect(() => {
    if (isOrganizationsLoading) return;
    if (!organization) navigate("/app", { replace: true });
  }, [isOrganizationsLoading, navigate, organization]);

  const invalidateMembers = () =>
    queryClient.invalidateQueries({
      queryKey: ["organization-members", params.organizationId],
    });

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || isInviting) return;
    setIsInviting(true);
    try {
      const { error } = await authClient.organization.inviteMember({
        email,
        role: inviteRole,
        organizationId: params.organizationId,
      });
      if (error) throw new Error(error.message);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("member");
      await invalidateMembers();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("members.inviteFailed"),
      );
    } finally {
      setIsInviting(false);
    }
  };

  const handleRoleChange = async (
    member: OrganizationMember,
    role: MemberRole,
  ) => {
    if (busyId) return;
    setBusyId(member.id);
    try {
      const { error } = await authClient.organization.updateMemberRole({
        memberId: member.id,
        role,
        organizationId: params.organizationId,
      });
      if (error) throw new Error(error.message);
      await invalidateMembers();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("members.roleChangeFailed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (member: OrganizationMember) => {
    if (busyId) return;
    const label = member.user.name || member.user.email;
    if (!window.confirm(t("members.removeConfirm", { name: label }))) {
      return;
    }
    setBusyId(member.id);
    try {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: member.id,
        organizationId: params.organizationId,
      });
      if (error) throw new Error(error.message);
      await invalidateMembers();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("members.removeFailed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleLeave = async () => {
    if (busyId) return;
    if (
      !window.confirm(
        t("members.leaveConfirm", { name: organization?.name || "" }),
      )
    ) {
      return;
    }
    setBusyId("leave");
    try {
      const { error } = await authClient.organization.leave({
        organizationId: params.organizationId,
      });
      if (error) throw new Error(error.message);
      await refreshOrganizations();
      navigate("/app", { replace: true });
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("members.leaveFailed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelInvitation = async (invitation: OrganizationInvitation) => {
    if (busyId) return;
    setBusyId(invitation.id);
    try {
      const { error } = await authClient.organization.cancelInvitation({
        invitationId: invitation.id,
      });
      if (error) throw new Error(error.message);
      await invalidateMembers();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("members.cancelInvitationFailed"),
      );
    } finally {
      setBusyId(null);
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
            <span className="truncate text-sm mx-2">{t("members.title")}</span>
          </div>
          {canManage && (
            <button
              className="console-button-primary h-10! px-3!"
              type="button"
              aria-label={t("members.invite")}
              onClick={() => setInviteOpen(true)}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("members.invite")}</span>
            </button>
          )}
        </div>
      </header>
      <main className="w-full">
        <section>
          {isPending ? (
            <ListSkeleton />
          ) : members.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("members.emptyTitle")}
              description={t("members.emptyDescription")}
            />
          ) : (
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-paper text-xs text-ink-mute">
                <tr>
                  <th className="px-3 py-3 sm:px-5">
                    {t("members.columns.member")}
                  </th>
                  <th className="w-32 px-3 py-3 sm:w-40 sm:px-5">
                    {t("common.role")}
                  </th>
                  <th className="hidden w-44 px-5 py-3 lg:table-cell">
                    {t("members.columns.joinedAt")}
                  </th>
                  <th className="w-16 px-3 py-3">
                    <span className="sr-only">
                      {t("members.columns.actions")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((member) => {
                  const isSelf = member.userId === user.id;
                  const canEditTarget =
                    canManage && !isSelf && member.role !== "owner";
                  return (
                    <tr className="hover:bg-paper" key={member.id}>
                      <td className="min-w-0 px-3 py-4 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-on-brand">
                            {(member.user.name || member.user.email)
                              .trim()
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs text-ink">
                              {member.user.name || member.user.email}
                              {isSelf && (
                                <span className="ml-1.5 rounded-full bg-paper px-1.5 py-0.5 text-[10px] text-ink-mute">
                                  {t("members.you")}
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-ink-mute">
                              {member.user.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 sm:px-5">
                        {canEditTarget ? (
                          <ConsoleSelect
                            value={member.role as MemberRole}
                            options={roleOptions}
                            disabled={busyId === member.id}
                            ariaLabel={t("members.roleFor", {
                              email: member.user.email,
                            })}
                            onChange={(role) =>
                              void handleRoleChange(member, role)
                            }
                          />
                        ) : (
                          <span className="inline-flex rounded-full bg-paper px-2 py-1 text-xs text-ink-mute ring-1 ring-line">
                            {roleLabel(member.role)}
                          </span>
                        )}
                      </td>
                      <td className="hidden px-5 py-4 text-ink-mute lg:table-cell">
                        {dateFormatter.format(new Date(member.createdAt))}
                      </td>
                      <td className="px-3 py-4 text-right">
                        {isSelf && member.role !== "owner" ? (
                          <button
                            className="inline-flex h-10 w-10 items-center justify-center rounded text-ink-mute hover:bg-danger-tint hover:text-danger"
                            type="button"
                            disabled={busyId !== null}
                            aria-label={t("members.leaveOrganization")}
                            title={t("members.leaveOrganization")}
                            onClick={() => void handleLeave()}
                          >
                            <LogOut className="h-4 w-4" />
                          </button>
                        ) : canEditTarget ? (
                          <button
                            className="inline-flex h-10 w-10 items-center justify-center rounded text-ink-mute hover:bg-danger-tint hover:text-danger"
                            type="button"
                            disabled={busyId !== null}
                            aria-label={t("members.removeMemberAria", {
                              email: member.user.email,
                            })}
                            onClick={() => void handleRemove(member)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {pendingInvitations.length > 0 && (
          <section className="border-t border-line">
            <h2 className="bg-paper px-3 py-3 text-xs text-ink-mute sm:px-5">
              {t("members.pendingInvitations", {
                count: pendingInvitations.length,
              })}
            </h2>
            <ul className="divide-y divide-line">
              {pendingInvitations.map((invitation) => (
                <li
                  className="flex items-center gap-3 px-3 py-4 hover:bg-paper sm:px-5"
                  key={invitation.id}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-ink-mute">
                    <Mail className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink">
                      {invitation.email}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-mute">
                      {t("members.invitationMeta", {
                        role: roleLabel(invitation.role || "member"),
                        date: dateFormatter.format(
                          new Date(invitation.expiresAt),
                        ),
                      })}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-ink-mute hover:bg-danger-tint hover:text-danger"
                      type="button"
                      disabled={busyId !== null}
                      aria-label={t("members.cancelInvitationAria", {
                        email: invitation.email,
                      })}
                      onClick={() => void handleCancelInvitation(invitation)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {inviteOpen && (
          <Modal
            title={t("members.invite")}
            onClose={() => setInviteOpen(false)}
          >
            <form className="space-y-4 p-5" onSubmit={handleInvite}>
              <label className="block">
                <span className="mb-1 block text-xs text-ink">
                  {t("common.email")}
                </span>
                <input
                  className="console-input"
                  type="email"
                  value={inviteEmail}
                  maxLength={320}
                  autoFocus
                  placeholder={t("members.emailPlaceholder")}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <span className="mt-1 block text-[10px] text-ink-mute">
                  {t("members.inviteHint")}
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink">
                  {t("common.role")}
                </span>
                <ConsoleSelect
                  value={inviteRole}
                  options={roleOptions}
                  ariaLabel={t("common.role")}
                  onChange={setInviteRole}
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="console-button-primary"
                  type="submit"
                  disabled={!inviteEmail.trim() || isInviting}
                >
                  {isInviting ? t("common.sending") : t("members.sendInvite")}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </main>
    </>
  );
}
