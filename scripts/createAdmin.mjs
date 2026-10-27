import bcrypt from "bcryptjs";
import { createConnection } from "mysql2/promise";

if (!process.env.DB_PASSWORD) {
  try {
    process.loadEnvFile(".env.local");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const missing = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "ADMIN_EMAIL", "ADMIN_PASSWORD"]
  .filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 12) {
  console.error("ADMIN_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const connection = await createConnection({
  host: DB_HOST,
  port: Number(DB_PORT || 3306),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  timezone: "Z",
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
  const [existing] = await connection.execute(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
  );
  if (Array.isArray(existing) && existing.length) {
    console.log("An admin account already exists; no account was changed.");
  } else {
    const password = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await connection.execute(
      `INSERT INTO users (first_name, last_name, email, password, role)
       VALUES ('Admin', '', LOWER(?), ?, 'admin')`,
      [ADMIN_EMAIL, password],
    );
    console.log(`Admin account created for ${ADMIN_EMAIL}.`);
  }
} catch (error) {
  console.error("Admin creation failed:", error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
