import type { AuditActor } from "@/lib/organization/audit";

export type OrganizationAuthorization = {
  actor: AuditActor;
  role: string | null;
};

export type ApiEnv = {
  Bindings: CloudflareEnv;
  Variables: {
    authorization: OrganizationAuthorization;
  };
};
