import fs from "node:fs";
import pg from "pg";

const file = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;

if (!file || !databaseUrl) {
  console.error("Usage: DATABASE_URL=... node scripts/apply-sql-file.mjs <file.sql>");
  process.exit(1);
}

const sql = fs.readFileSync(file, "utf8");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000
});

try {
  await client.connect();
  await client.query(sql);
  console.log(`Applied ${file}`);
} finally {
  await client.end().catch(() => undefined);
}
