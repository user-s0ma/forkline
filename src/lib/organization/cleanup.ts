import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { invitation, member, organization } from "../db/schema";
import { detectLocale, translate } from "../i18n";
import { retireOrganizationModels } from "../compute/retire";

/**
 * アカウントを消す前に、自分だけの組織を消し、ほかの組織からは抜ける。
 * ほかのメンバーがいる組織のオーナーなら、先にオーナーを渡してもらう
 */
export async function leaveOrganizationsForDeletion(
  env: CloudflareEnv,
  userId: string,
  request?: Request,
): Promise<void> {
  const db = getDb(env);
  const memberships = await db
    .select({
      organizationId: member.organizationId,
      role: member.role,
      name: organization.name,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
  const owned = memberships.filter((m) => m.role.split(",").includes("owner"));

  for (const org of owned) {
    const members = await db.$count(member, eq(member.organizationId, org.organizationId));
    if (members > 1) {
      throw new APIError("CONFLICT", {
        message: translate(detectLocale(request), "server.account.ownerOfShared", { name: org.name }),
      });
    }
  }
  for (const org of owned) {
    await retireOrganizationModels(env, org.organizationId);
    await db.delete(invitation).where(eq(invitation.organizationId, org.organizationId));
    await db.delete(member).where(eq(member.organizationId, org.organizationId));
    await db.delete(organization).where(eq(organization.id, org.organizationId));
  }
  await db.delete(member).where(eq(member.userId, userId));
}
