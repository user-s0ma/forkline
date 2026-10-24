import { defineConfig } from "drizzle-kit";

const migrationUrl = new URL(process.env.DATABASE_URL);
migrationUrl.searchParams.delete("sslaccept");
migrationUrl.searchParams.set(
  "ssl",
  JSON.stringify({ rejectUnauthorized: true }),
);

export default defineConfig({
  schema: "./src/lib/db/schema",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: migrationUrl.toString(),
  },
});
