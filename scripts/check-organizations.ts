// 組織をなくすマイグレーション (drizzle/0004_remove_organizations.sql) の前に、DB を読むだけで確かめる。
//   npx tsx scripts/check-organizations.ts
// 組織の ID はその組織のオーナーの利用者 ID に置き換えるので、次のどれかがあれば移せない (終了コード 1)
//   - オーナーのいない組織に、モデル・学習・残高・キーなどが残っている (持ち主がいなくなる)
//   - 1人が2つ以上の組織のオーナー (残高の行が重なる)
// オーナー以外のメンバーは、移したあとその組織のものを見られなくなる。数だけ出す
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const env: Record<string, string> = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = new URL(env.DATABASE_URL);
url.searchParams.delete("sslaccept");
const db = await mysql.createConnection({ uri: url.toString(), ssl: { rejectUnauthorized: true } });

type Row = Record<string, unknown>;
const query = async (sql: string) => (await db.query(sql))[0] as Row[];
const OWNER = "FIND_IN_SET('owner', m.role)";

const owners = await query(`SELECT m.organizationId, COUNT(*) AS owners FROM Member m WHERE ${OWNER} GROUP BY m.organizationId`);
const ownerCount = new Map(owners.map((row) => [String(row.organizationId), Number(row.owners)]));

const columns: Array<[string, string]> = [
  ["Wallet", "organizationId"],
  ["LedgerEntry", "organizationId"],
  ["ApiKey", "organizationId"],
  ["AiModel", "organizationId"],
  ["FineTune", "organizationId"],
  ["EvalRun", "organizationId"],
  ["UsageRecord", "publisherOrganizationId"],
  ["UsageRecord", "consumerOrganizationId"],
];
const problems: string[] = [];

for (const [table, column] of columns) {
  const rows = await query(`SELECT ${column} AS id, COUNT(*) AS n FROM ${table} GROUP BY ${column}`);
  for (const row of rows) {
    const owners = ownerCount.get(String(row.id)) ?? 0;
    if (owners !== 1) {
      problems.push(`${table}.${column}=${row.id}: ${row.n} 行、オーナー ${owners} 人`);
    }
  }
}

const multi = await query(`SELECT m.userId, COUNT(*) AS n FROM Member m WHERE ${OWNER} GROUP BY m.userId HAVING n > 1`);
for (const row of multi) problems.push(`利用者 ${row.userId} が ${row.n} 個の組織のオーナー`);

const [others] = await query(`SELECT COUNT(*) AS n FROM Member m WHERE NOT ${OWNER}`);
const [pending] = await query(`SELECT COUNT(*) AS n FROM Invitation WHERE status = 'pending'`);
const [counts] = await query(
  "SELECT (SELECT COUNT(*) FROM User) AS users, (SELECT COUNT(*) FROM Organization) AS organizations, (SELECT COUNT(*) FROM Member) AS members",
);
await db.end();

console.log(`利用者 ${counts.users} 人、組織 ${counts.organizations} 個、メンバー ${counts.members} 人`);
console.log(`オーナー以外のメンバー: ${others.n} 人 (移したあと、その組織のものは見られなくなる)`);
console.log(`保留中の招待: ${pending.n} 件 (消える)`);
if (problems.length > 0) {
  console.log("移せない:");
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}
console.log("移せます");
