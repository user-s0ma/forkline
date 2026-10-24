import { redirect } from "react-router";
import type { Route } from "./+types/_index";

/** 組織を開いたら、まずモデルの一覧を見せる */
export function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/app/${encodeURIComponent(params.organizationId)}/models`);
}
