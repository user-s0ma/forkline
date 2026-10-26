import { redirect } from "react-router";

/** コンソールを開いたら、まずモデルの一覧を見せる */
export function loader() {
  throw redirect("/app/models");
}
