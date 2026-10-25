import assert from "node:assert/strict";
import test from "node:test";
import {
  hasRequiredRole,
  resolveOrganizationAuthorization,
} from "../src/server/api/organizations/access";

const session = {
  user: { id: "user-1", name: "利用者", email: "user@example.com" },
};

test("未ログインと所属なしを区別する", () => {
  assert.deepEqual(resolveOrganizationAuthorization(null, null), {
    error: "unauthorized",
  });
  assert.deepEqual(resolveOrganizationAuthorization(session, null), {
    error: "forbidden",
  });
});

test("所属ユーザーの監査主体とロールを返す", () => {
  assert.deepEqual(
    resolveOrganizationAuthorization(session, { role: "admin" }),
    {
      actor: { id: "user-1", name: "利用者", email: "user@example.com" },
      role: "admin",
    },
  );
});

test("必要ロールをowner/admin/memberで判定する", () => {
  assert.equal(hasRequiredRole("owner", ["owner", "admin"]), true);
  assert.equal(hasRequiredRole("admin", ["owner", "admin"]), true);
  assert.equal(hasRequiredRole("member", ["owner", "admin"]), false);
  assert.equal(hasRequiredRole(null, ["owner"]), false);
});
