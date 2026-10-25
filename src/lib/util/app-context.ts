import { createContext } from "react-router";

export const appContext = createContext<{
  env: AppEnv;
  ctx: ExecutionContext;
}>();

