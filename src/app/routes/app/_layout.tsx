import { useState } from "react";
import { Link, Outlet, redirect, useLocation } from "react-router";
import type { Route } from "./+types/_layout";
import {
  BarChart3,
  Boxes,
  Coins,
  CreditCard,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/auth/server";
import { appContext } from "@/lib/util/app-context";
import { LogoMark } from "@/components/ui/LogoMark";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export type AppLayoutContext = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  openMobileNavigation: () => void;
  setUserName: (name: string) => void;
};

type NavGroup = {
  labelKey?: string;
  items: Array<{
    labelKey: string;
    icon: LucideIcon;
    path: string;
    matchChildren?: boolean;
  }>;
};

const NAV_GROUPS: NavGroup[] = [
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
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [user, setUser] = useState(loaderData.user);

  const userInitial =
    user.name.trim().charAt(0) || user.email.trim().charAt(0).toUpperCase();
  const normalizedPath = location.pathname.replace(/\/$/, "");
  const outletContext: AppLayoutContext = {
    user,
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
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.labelKey || groupIndex}>
              {group.labelKey && (
                <p className="mb-2 px-3 text-xs font-semibold text-ink-mute">
                  {t(group.labelKey)}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const target = `/app${item.path}`;
                  const active =
                    normalizedPath === target ||
                    (Boolean(item.matchChildren) &&
                      normalizedPath.startsWith(`${target}/`));
                  return (
                    <Link
                      key={item.labelKey}
                      className={`console-nav-item ${
                        active ? "bg-brand-tint" : ""
                      }`}
                      to={target}
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
