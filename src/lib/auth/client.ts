import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? import.meta.env.VITE_PUBLIC_APP_URL
      : window.location.origin,
});
