import mysql, {
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

type DatabaseRow = RowDataPacket & Record<string, unknown>;
type SqlValue = string | number | boolean | Date | null | object;
type QueryResult<Row> = {
  rows: Row[];
  rowCount: number;
};
type Queryable = {
  query<Row extends DatabaseRow = DatabaseRow>(
    text: string,
    values?: SqlValue[],
  ): Promise<QueryResult<Row>>;
};

type MySqlCache = {
  pool: mysql.Pool | null;
};

const globalWithPool = globalThis as typeof globalThis & {
  mysqlCache?: MySqlCache;
};

const cache = (globalWithPool.mysqlCache ??= { pool: null });

function getPool() {
  if (cache.pool) return cache.pool;

  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  const missing = [
    ["DB_HOST", DB_HOST],
    ["DB_NAME", DB_NAME],
    ["DB_USER", DB_USER],
    ["DB_PASSWORD", DB_PASSWORD],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing MySQL environment variables: ${missing.join(", ")}`);
  }

  cache.pool = mysql.createPool({
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
    connectionLimit: 15,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 5_000,
    supportBigNumbers: true,
  });

  cache.pool.on("connection", (connection) => {
    connection.on("error", (error) => {
      console.error("Unexpected MySQL connection error:", error);
    });
  });

  return cache.pool;
}

function compileSql(text: string, values: SqlValue[] = []) {
  const parameters: SqlValue[] = [];
  const sql = text.replace(
    /([A-Za-z_][\w.]*)\s*=\s*ANY\(\$(\d+)::(?:int|integer|text)\[\]\)|\$([1-9]\d*)|::(?:jsonb?|text|int|integer|bigint|numeric|date|boolean)|json_build_object/gi,
    (token, column: string | undefined, arrayIndex: string | undefined, valueIndex: string | undefined) => {
      if (column && arrayIndex) {
        const array = values[Number(arrayIndex) - 1];
        if (!Array.isArray(array)) {
          throw new TypeError(`Expected an array for SQL parameter $${arrayIndex}`);
        }
        if (array.length === 0) return "1 = 0";
        parameters.push(...array);
        return `${column} IN (${array.map(() => "?").join(", ")})`;
      }

      if (valueIndex) {
        const value = values[Number(valueIndex) - 1];
        if (value === undefined) {
          throw new TypeError(`Missing SQL parameter $${valueIndex}`);
        }
        parameters.push(value);
        return "?";
      }

      if (token.toLowerCase() === "json_build_object") return "JSON_OBJECT";
      return "";
    },
  );
  return { sql, parameters };
}

function isResultHeader(result: unknown): result is ResultSetHeader {
  return typeof result === "object" && result !== null && "affectedRows" in result;
}

async function execute<Row extends DatabaseRow>(
  connection: PoolConnection,
  text: string,
  values: SqlValue[] = [],
): Promise<QueryResult<Row>> {
  const returning = text.match(/\s+RETURNING\s+([\s\S]+?)\s*;?\s*$/i);
  const statement = returning ? text.slice(0, returning.index).trim() : text;

  if (!returning) {
    const compiled = compileSql(statement, values);
    const [result] = await connection.query(compiled.sql, compiled.parameters);
    if (isResultHeader(result)) {
      return { rows: [], rowCount: result.affectedRows };
    }
    if (!Array.isArray(result)) return { rows: [], rowCount: 0 };
    return { rows: result as Row[], rowCount: result.length };
  }

  const tableMatch = statement.match(/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([`"\w]+)/i);
  if (!tableMatch) {
    throw new Error("Unable to process RETURNING clause for MySQL");
  }
  const table = tableMatch[2].replace(/[`"]/g, "");
  const operation = tableMatch[1].toUpperCase();
  const whereMatch = statement.match(/\bWHERE\b([\s\S]*)$/i);

  if (operation.startsWith("DELETE")) {
    if (!whereMatch) throw new Error("DELETE RETURNING requires a WHERE clause");
    const select = `SELECT ${returning[1]} FROM \`${table}\` WHERE ${whereMatch[1]}`;
    const compiledSelect = compileSql(select, values);
    const [selected] = await connection.query(compiledSelect.sql, compiledSelect.parameters);
    const compiledDelete = compileSql(statement, values);
    const [deleted] = await connection.query(compiledDelete.sql, compiledDelete.parameters);
    return {
      rows: (Array.isArray(selected) ? selected : []) as Row[],
      rowCount: isResultHeader(deleted) ? deleted.affectedRows : 0,
    };
  }

  const compiled = compileSql(statement, values);
  const [result] = await connection.query(compiled.sql, compiled.parameters);
  const rowCount = isResultHeader(result) ? result.affectedRows : 0;

  if (operation.startsWith("INSERT")) {
    if (!isResultHeader(result) || !result.insertId) return { rows: [], rowCount };
    const [selected] = await connection.query(
      `SELECT ${returning[1]} FROM \`${table}\` WHERE id = ?`,
      [result.insertId],
    );
    return { rows: (Array.isArray(selected) ? selected : []) as Row[], rowCount };
  }

  if (!whereMatch) throw new Error("UPDATE RETURNING requires a WHERE clause");
  const select = `SELECT ${returning[1]} FROM \`${table}\` WHERE ${whereMatch[1]}`;
  const compiledSelect = compileSql(select, values);
  const [selected] = await connection.query(compiledSelect.sql, compiledSelect.parameters);
  return {
    rows: (Array.isArray(selected) ? selected : []) as Row[],
    rowCount,
  };
}

export default function dbConnect() {
  return getPool();
}

export const connectDB = dbConnect;

export function query<Row extends DatabaseRow = DatabaseRow>(
  text: string,
  values?: SqlValue[],
): Promise<QueryResult<Row>> {
  return getPool().getConnection().then(async (connection) => {
    try {
      return await execute(connection, text, values);
    } finally {
      connection.release();
    }
  });
}

export async function withTransaction<T>(
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  const connection = await getPool().getConnection();
  const client: Queryable = {
    query: (text, values) => execute(connection, text, values),
  };
  try {
    await connection.beginTransaction();
    const result = await callback(client);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const isValidId = (id: unknown): id is string =>
  typeof id === "string" && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
