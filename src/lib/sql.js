import { query } from "@/lib/db";

export const camelizeRow = (row) => {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[normalizedKey] = normalizedKey === "rating" && value !== null
      ? Number(value)
      : value;
  }
  if (result.id !== undefined) {
    result._id = String(result.id);
    delete result.id;
  }
  return result;
};

export const rows = async (text, values) =>
  (await query(text, values)).rows.map(camelizeRow);

export const one = async (text, values) =>
  camelizeRow((await query(text, values)).rows[0] || null);

export const existsId = (id) =>
  typeof id === "string" && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
