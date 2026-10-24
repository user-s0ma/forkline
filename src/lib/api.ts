import { clientLocale, translate } from "@/lib/i18n";

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as
    (T & { message?: string }) | null;
  if (!response.ok) {
    throw new Error(
      data?.message || translate(clientLocale(), "common.apiError"),
    );
  }
  return data as T;
}

export type OrganizationAccess = {
  role: string;
};

export function getOrganizationAccess(organizationId: string) {
  return apiRequest<OrganizationAccess>(
    `/api/organizations/${encodeURIComponent(organizationId)}/access`,
  );
}

export type AuditLogItem = {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  targetId: string | null;
  targetLabel: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export function listAuditLogs(
  organizationId: string,
  options: { cursor?: string; action?: string; pageSize: number },
) {
  const query = new URLSearchParams({ pageSize: String(options.pageSize) });
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.action) query.set("action", options.action);
  return apiRequest<{
    items: AuditLogItem[];
    nextCursor: string | null;
  }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/audit-logs?${query}`,
  );
}
