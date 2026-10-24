import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? import.meta.env.VITE_PUBLIC_APP_URL
      : window.location.origin,
  plugins: [organizationClient()],
});
