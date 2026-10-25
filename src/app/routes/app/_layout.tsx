import { useCallback, useEffect, useState } from "react";
import {
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import type { Route } from "./+types/_layout";
import {
  Activity,
  BarChart3,
  Boxes,
  Building2,
  Coins,
  CreditCard,
  Settings,
  Sparkles,
  SquareTerminal,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/auth/server";
import { authClient } from "@/lib/auth/client";
import { appContext } from "@/lib/util/app-context";
import { getOrganizationAccess, type OrganizationAccess } from "@/lib/api";
import { ConsoleSelect } from "@/components/ui/ConsoleSelect";
import { LogoMark } from "@/components/ui/LogoMark";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
};

export type AppLayoutContext = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  organizations: OrganizationSummary[];
  isOrganizationsLoading: boolean;
  activeOrganizationId: string | null;
  selectingOrganizationId: string | null;
  activeRole: string | null;
  canManageOrganization: boolean;
  refreshOrganizations: () => Promise<void>;
  refreshAccess: () => Promise<OrganizationAccess | null>;
  selectOrganization: (organizationId: string) => Promise<boolean>;
  openMobileNavigation: () => void;
  setUserName: (name: string) => void;
};

type NavGroup = {
  labelKey?: string;
  items: Array<{
    labelKey: string;
    icon: LucideIcon;
    path?: string;
    matchChildren?: boolean;
  }>;
};

const ORGANIZATION_NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "appShell.navGroups.build",
    items: [
      {
        labelKey: "appShell.nav.models",
        icon: Sparkles,
        path: "/models",
        matchChildren: true,
      },
      { labelKey: "appShell.nav.explore", icon: Boxes, path: "/explore" },
    ],
  },
  {
    labelKey: "appShell.navGroups.billing",
    items: [
      { labelKey: "appShell.nav.apiKeys", icon: SquareTerminal, path: "/api-keys" },
      { labelKey: "appShell.nav.usage", icon: BarChart3, path: "/usage" },
      { labelKey: "appShell.nav.billing", icon: CreditCard, path: "/billing" },
      { labelKey: "appShell.nav.earnings", icon: Coins, path: "/earnings" },
    ],
  },
  {
    labelKey: "appShell.navGroups.organization",
    items: [
      { labelKey: "appShell.nav.members", icon: Users, path: "/members" },
      {
        labelKey: "appShell.nav.auditLogs",
        icon: Activity,
        path: "/audit-logs",
      },
      {
        labelKey: "common.settings",
        icon: Settings,
        path: "/settings",
      },
    ],
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const session = await auth(env, new URL(request.url).origin).api.getSession({
    headers: request.headers,
  });
  if (!session) {
    const callbackUrl = encodeURIComponent(new URL(request.url).pathname);
    throw redirect(`/login?callbackUrl=${callbackUrl}`);
  }

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    activeOrganizationId: session.session.activeOrganizationId || null,
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ organizationId: string }>();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [isOrganizationsLoading, setIsOrganizationsLoading] = useState(true);
  const [activeOrganizationId, setActiveOrganizationId] = useState(
    loaderData.activeOrganizationId,
  );
  const [selectingOrganizationId, setSelectingOrganizationId] = useState<
    string | null
  >(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [user, setUser] = useState(loaderData.user);

  const refreshOrganizations = useCallback(async () => {
    try {
      const { data, error } = await authClient.organization.list();
      if (error) throw new Error(error.message);
      setOrganizations((data || []) as OrganizationSummary[]);
    } catch (error) {
      console.error(error);
      toast.error(t("appShell.loadOrganizationsFailed"));
    } finally {
      setIsOrganizationsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshOrganizations(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshOrganizations]);

  useEffect(() => {
    const organizationId = params.organizationId;
    if (
      !organizationId ||
      isOrganizationsLoading ||
      activeOrganizationId === organizationId ||
      !organizations.some((organization) => organization.id === organizationId)
    ) {
      return;
    }

    let cancelled = false;
    void authClient.organization
      .setActive({ organizationId })
      .then(({ error }) => {
        if (cancelled) return;
        if (error) {
          toast.error(t("appShell.selectOrganizationFailed"));
          return;
        }
        setActiveOrganizationId(organizationId);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeOrganizationId,
    isOrganizationsLoading,
    organizations,
    params.organizationId,
    t,
  ]);

  const accessOrganizationId = params.organizationId || "";
  const accessQuery = useQuery({
    queryKey: ["organization-access", accessOrganizationId],
    queryFn: () => getOrganizationAccess(accessOrganizationId),
    enabled: Boolean(accessOrganizationId),
  });
  const organizationAccess = accessOrganizationId
    ? (accessQuery.data ?? null)
    : null;
  const { refetch: refetchAccess } = accessQuery;
  const refreshAccess = useCallback(
    async () => (await refetchAccess()).data ?? null,
    [refetchAccess],
  );

  const selectOrganization = useCallback(
    async (organizationId: string) => {
      if (selectingOrganizationId) return false;
      setSelectingOrganizationId(organizationId);
      try {
        const { error } = await authClient.organization.setActive({
          organizationId,
        });
        if (error) throw new Error(error.message);
        setActiveOrganizationId(organizationId);
        navigate(`/app/${encodeURIComponent(organizationId)}/`);
        return true;
      } catch (error) {
        console.error(error);
        toast.error(t("appShell.selectOrganizationFailed"));
        return false;
      } finally {
        setSelectingOrganizationId(null);
      }
    },
    [navigate, selectingOrganizationId, t],
  );

  const userInitial =
    user.name.trim().charAt(0) || user.email.trim().charAt(0).toUpperCase();
  const selectedOrganizationId = params.organizationId || "";
  const isOrganizationScope = Boolean(params.organizationId);
  const activeRole = organizationAccess?.role ?? null;
  const canManageOrganization = (activeRole || "")
    .split(",")
    .some((role) => role === "owner" || role === "admin");
  const navGroups = isOrganizationScope ? ORGANIZATION_NAV_GROUPS : [];
  const normalizedPath = location.pathname.replace(/\/$/, "");
  const organizationBase = selectedOrganizationId
    ? `/app/${encodeURIComponent(selectedOrganizationId)}`
    : "";
  const outletContext: AppLayoutContext = {
    user,
    organizations,
    isOrganizationsLoading,
    activeOrganizationId,
    selectingOrganizationId,
    activeRole,
    canManageOrganization,
    refreshOrganizations,
    refreshAccess,
    selectOrganization,
    openMobileNavigation: () => setMobileNavOpen(true),
    setUserName: (name) => setUser((prev) => ({ ...prev, name })),
  };

  return (
    <div className="min-h-dvh font-sans antialiased">
      {mobileNavOpen && (
        <button
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
          type="button"
          aria-label={t("appShell.closeMenu")}
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-line bg-surface transition-transform duration-200 lg:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-1">
            <LogoMark />
            <span className="text-lg font-bold tracking-tight text-ink">Forkline</span>
          </Link>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-mute hover:bg-paper hover:text-ink lg:hidden"
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label={t("appShell.closeMenu")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 pb-3">
          <ConsoleSelect
            value={selectedOrganizationId}
            options={organizations.map((organization) => ({
              value: organization.id,
              label: organization.name,
              icon: Building2,
            }))}
            placeholder={t("appShell.selectOrganization")}
            disabled={selectingOrganizationId !== null}
            onChange={(organizationId) => {
              setMobileNavOpen(false);
              void selectOrganization(organizationId);
            }}
          />
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
          {navGroups.map((group, groupIndex) => (
            <div key={group.labelKey || groupIndex}>
              {group.labelKey && (
                <p className="mb-2 px-3 text-xs font-semibold text-ink-mute">
                  {t(group.labelKey)}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const target =
                    item.path !== undefined
                      ? `${organizationBase}${item.path}`
                      : null;
                  const href =
                    target === organizationBase ? `${target}/` : target;
                  const active =
                    target !== null &&
                    (normalizedPath === target ||
                      (Boolean(item.matchChildren) &&
                        normalizedPath.startsWith(`${target}/`)));
                  if (!href) return null;
                  return (
                    <Link
                      key={item.labelKey}
                      className={`console-nav-item ${
                        active ? "bg-brand-tint" : ""
                      }`}
                      to={href}
                      onClick={() => setMobileNavOpen(false)}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-4 pb-2">
          <ThemeToggle />
        </div>
        <Link
          className={`flex min-w-0 items-center p-2 gap-2 rounded-xl  border-t border-line text-left transition-colors hover:bg-paper ${
            normalizedPath === "/app/account" ? "bg-brand-tint" : ""
          }`}
          to="/app/account"
          aria-label={t("appShell.profile")}
          onClick={() => setMobileNavOpen(false)}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-on-brand ring-2 ring-surface">
            {userInitial}
          </span>
          <span className="truncate text-sm mx-2">
            {user.name || user.email}
          </span>
        </Link>
      </aside>
      <div className="min-h-dvh lg:pl-64">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}
