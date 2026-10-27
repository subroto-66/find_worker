import { readFile } from "node:fs/promises";
import path from "node:path";
import { createConnection } from "mysql2/promise";

if (!process.env.DB_PASSWORD && process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(".env.local");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const missing = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]
  .filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing MySQL environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const connection = await createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  timezone: "Z",
  multipleStatements: true,
  ssl: process.env.DB_SSL?.toLowerCase() === "true"
    ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
        ...(process.env.DB_SSL_CA
          ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, "\n") }
          : {}),
      }
    : undefined,
});

try {
  const schema = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await connection.query(schema);
  console.log(`MySQL schema initialized in database "${process.env.DB_NAME}".`);
} catch (error) {
  console.error("MySQL schema initialization failed:", error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
