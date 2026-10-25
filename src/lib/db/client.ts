import { connect } from "@tidbcloud/serverless";
import { drizzle } from "drizzle-orm/tidb-serverless";

import * as schema from "./schema";

export function getDb(env: AppEnv) {
  const client = connect({
    url: env.DATABASE_URL,
  });
  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof getDb>;

/** 検索語の % と _ は文字として扱う。 */
export function containsPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
