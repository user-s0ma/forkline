import { getDb } from "../db/client";
import { auditLog } from "../db/schema";

export const AUDIT_ACTIONS = [
  "organization.create",
  "organization.update",
  "organization.delete",
  "member.remove",
  "member.leave",
  "member.role_update",
  "invitation.create",
  "invitation.accept",
  "invitation.reject",
  "invitation.cancel",
  "model.create",
  "model.update",
  "model.delete",
  "model.publish",
  "model.unpublish",
  "fine_tune.start",
  "fine_tune.cancel",
  "endpoint.deploy",
  "endpoint.start",
  "endpoint.stop",
  "endpoint.delete",
  "dataset.generate",
  "evaluation.start",
  "model_card.draft",
  "api_key.create",
  "api_key.revoke",
  "billing.topup_start",
  "billing.connect",
  "billing.payout",
  "billing.payout_pending",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditActor = {
  id: string;
  name: string;
  email: string;
};

export async function recordAuditLog(
  env: AppEnv,
  entry: {
    organizationId: string;
    actor: AuditActor;
    action: AuditAction;
    targetId?: string | null;
    targetLabel?: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await getDb(env)
      .insert(auditLog)
      .values({
        id: crypto.randomUUID(),
        organizationId: entry.organizationId,
        actorId: entry.actor.id,
        actorName: entry.actor.name,
        actorEmail: entry.actor.email,
        action: entry.action,
        targetId: entry.targetId ?? null,
        targetLabel: (entry.targetLabel ?? "").slice(0, 500),
        metadata: JSON.stringify(entry.metadata ?? {}),
        createdAt: new Date(),
      });
  } catch (error) {
    console.error("監査ログを記録できませんでした:", entry.action, error);
  }
}
