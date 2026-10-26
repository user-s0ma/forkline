import {
  type RouteConfig,
  type RouteConfigEntry,
  route,
  index,
} from "@react-router/dev/routes";
import { MARKETING_PATHS, NON_DEFAULT_LOCALES } from "../lib/i18n/locales";

const file = (path: string) =>
  path === "/" ? "routes/_index.tsx" : `routes/${path.slice(1)}.tsx`;
const seg = (path: string) => (path === "/" ? "home" : path.slice(1));
const subPaths = MARKETING_PATHS.filter((p) => p !== "/");

const marketing: RouteConfigEntry[] = subPaths.map((path) =>
  route(path.slice(1), file(path)),
);

const localeMirrors: RouteConfigEntry[] = NON_DEFAULT_LOCALES.flatMap(
  (locale) =>
    MARKETING_PATHS.map((path) =>
      route(path === "/" ? locale : `${locale}${path}`, file(path), {
        id: `${seg(path)}-${locale}`,
      }),
    ),
);

export default [
  index("routes/_index.tsx"),
  ...marketing,
  ...localeMirrors,

  route("robots.txt", "routes/robots.txt.tsx"),
  route("sitemap.xml", "routes/sitemap.xml.tsx"),

  route("models/:slug", "routes/models.$slug.tsx"),

  route("login", "routes/login.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("app", "routes/app/_layout.tsx", [
    index("routes/app/_index.tsx"),
    route("account", "routes/app/account.tsx"),
    route("models", "routes/app/models/_index.tsx"),
    route("models/:modelId", "routes/app/models/$modelId.tsx"),
    route("explore", "routes/app/explore.tsx"),
    route("api-keys", "routes/app/api-keys.tsx"),
    route("usage", "routes/app/usage.tsx"),
    route("billing", "routes/app/billing.tsx"),
    route("earnings", "routes/app/earnings.tsx"),
  ]),

  route("*", "routes/$.tsx"),
] satisfies RouteConfig;
