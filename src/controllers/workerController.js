import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import dbConnect, { query, withTransaction } from "@/lib/db";
import { existsId, one, rows } from "@/lib/sql";
import { hasUpload, saveFile, removeFile } from "@/lib/upload";

const AVATAR_MAX = 5 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_ITEMS = 20;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const fail = (message, status = 400) => NextResponse.json({ message }, { status });
class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const handleError = (error, label) => {
  if (error instanceof HttpError) return fail(error.message, error.status);
  if (error.code === "ER_DUP_ENTRY") return fail("A user with this email already exists", 409);
  if (
    error.code === "ER_NO_REFERENCED_ROW_2"
    || error.code === "ER_ROW_IS_REFERENCED_2"
    || error.code === "ER_TRUNCATED_WRONG_VALUE"
  ) return fail("Invalid worker data", 400);
  console.error(`${label} error:`, error);
  return fail("Internal Server error", 500);
};
const badId = (id) => !existsId(id);
const str = (value, max, label, { required = false } = {}) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new HttpError(`${label} is required`);
  if (text.length > max) throw new HttpError(`${label} is too long (max ${max})`);
  return text;
};
const url = (value, label, { required = false } = {}) => {
  const text = str(value, 500, label, { required });
  if (!text) return "";
  let parsed;
  try { parsed = new URL(text); } catch { throw new HttpError(`${label} must be a valid URL`); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new HttpError(`${label} must start with http:// or https://`);
  return text;
};
const month = (value, label) => {
  const text = str(value, 7, label);
  if (text && !MONTH_RE.test(text)) throw new HttpError(`${label} must be in YYYY-MM format`);
  return text;
};
const checkRange = (start, end, label) => {
  if (start && end && start > end) throw new HttpError(`${label}: end date can't be before start date`);
};
function parseList(raw, label) {
  if (raw === null || raw === undefined || raw === "") return [];
  let value;
  try { value = JSON.parse(raw); } catch { throw new HttpError(`${label} is invalid`); }
  if (!Array.isArray(value)) throw new HttpError(`${label} is invalid`);
  const result = value.filter((row) => row && typeof row === "object"
    && Object.values(row).some((item) => String(item ?? "").trim()));
  if (result.length > MAX_ITEMS) throw new HttpError(`${label}: max ${MAX_ITEMS} items allowed`);
  return result;
}
function parseIds(raw) {
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { throw new HttpError("Work samples list is invalid"); }
  if (!Array.isArray(value) || value.some((id) => !existsId(id))) throw new HttpError("Work samples list is invalid");
  const ids = [...new Set(value)];
  if (ids.length > 50) throw new HttpError("Too many work samples (max 50)");
  return ids;
}

async function buildData(form, { isEdit = false } = {}) {
  const firstName = str(form.get("firstName"), 50, "First name", { required: true });
  const lastName = str(form.get("lastName"), 50, "Last name", { required: true });
  const email = str(form.get("email"), 150, "Email", { required: true }).toLowerCase();
  const password = str(form.get("password"), 100, "Password");
  if (!isEdit && !password) throw new HttpError("Password is required");
  const createdBy = str(form.get("createdBy"), 50, "Created by");
  const role = str(form.get("role"), 20, "Role");
  const status = str(form.get("status"), 20, "Status");
  const gender = str(form.get("gender"), 20, "Gender");
  const language = str(form.get("language"), 50, "Language");
  const badge = str(form.get("badge"), 50, "Badge");
  const location = str(form.get("location"), 100, "Location");
  const about = str(form.get("about"), 5000, "About");
  const categoryId = String(form.get("category") ?? "");
  if (badId(categoryId)) throw new HttpError("Please select a category");
  if (!(await query("SELECT 1 FROM categories WHERE id=$1", [categoryId])).rowCount) {
    throw new HttpError("Selected category does not exist");
  }
  const dobRaw = str(form.get("dateOfBirth"), 10, "Date of birth");
  let dateOfBirth = null;
  if (dobRaw) {
    const date = new Date(dobRaw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobRaw) || Number.isNaN(date.getTime())
      || date > new Date() || date.getUTCFullYear() < 1900) throw new HttpError("Date of birth is invalid");
    dateOfBirth = dobRaw;
  }
  const seen = new Set();
  const skills = String(form.get("skills") ?? "").split(",").map((item) => item.trim()).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (skills.length > 30) throw new HttpError("Too many skills (max 30)");
  if (skills.some((item) => item.length > 40)) throw new HttpError("A skill is too long (max 40)");
  const marketplaceBadges = parseList(form.get("marketplaceBadges"), "Marketplace badges").map((row, index) => {
    const label = `Marketplace badge #${index + 1}`;
    return { platform: str(row.platform, 40, `${label} platform`, { required: true }),
      badge: str(row.badge, 60, `${label} badge`), url: url(row.url, `${label} URL`, { required: true }) };
  });
  const education = parseList(form.get("education"), "Education").map((row, index) => {
    const label = `Education #${index + 1}`;
    const startDate = month(row.startDate, `${label} start date`);
    const endDate = month(row.endDate, `${label} end date`);
    checkRange(startDate, endDate, label);
    return { degree: str(row.degree, 120, `${label} degree`, { required: true }),
      institute: str(row.institute, 120, `${label} institute`, { required: true }),
      startDate, endDate, description: str(row.description, 1000, `${label} description`) };
  });
  const experience = parseList(form.get("experience"), "Experience").map((row, index) => {
    const label = `Experience #${index + 1}`;
    const startDate = month(row.startDate, `${label} start date`);
    const endDate = month(row.endDate, `${label} end date`);
    checkRange(startDate, endDate, label);
    return { role: str(row.role, 120, `${label} job role`, { required: true }),
      company: str(row.company, 120, `${label} company name`, { required: true }),
      startDate, endDate, description: str(row.description, 1000, `${label} description`) };
  });
  const linkedProfiles = parseList(form.get("linkedProfiles"), "Linked profiles").map((row, index) => {
    const label = `Linked profile #${index + 1}`;
    return { platform: str(row.platform, 40, `${label} platform`, { required: true }),
      badge: str(row.badge, 60, `${label} badge`), title: str(row.title, 80, `${label} title`),
      subtitle: str(row.subtitle, 160, `${label} subtitle`), link: url(row.link, `${label} link`, { required: true }) };
  });
  const workSampleIds = parseIds(form.get("workSamples"));
  const avatarFile = form.get("avatar");
  if (hasUpload(avatarFile)) {
    if (!AVATAR_TYPES.includes(avatarFile.type)) throw new HttpError("Avatar must be a JPG, PNG, WEBP or GIF image");
    if (avatarFile.size > AVATAR_MAX) throw new HttpError("Avatar is too large (max 5MB)");
  }
  return {
    fields: { firstName, lastName, email, password, role, status, createdBy, gender, language, badge,
      categoryId, location, dateOfBirth, about, skills, marketplaceBadges, education, experience, linkedProfiles },
    workSampleIds,
    avatarFile: hasUpload(avatarFile) ? avatarFile : null,
  };
}

async function ensureAvailable(client, ids, workerId) {
  if (!ids.length) return;
  const { rows: found } = await client.query(
    "SELECT id, seller_id FROM work_samples WHERE id=ANY($1::int[]) FOR UPDATE", [ids],
  );
  if (found.length !== ids.length) throw new HttpError("One or more work samples no longer exist");
  if (found.some((sample) => sample.seller_id && String(sample.seller_id) !== String(workerId))) {
    throw new HttpError("One or more work samples are already assigned to another seller", 409);
  }
}

async function getFull(id) {
  const worker = await one(`SELECT w.id, w.user_id, w.category_id, w.gender, w.status, w.created_by,
    w.language, w.badge, w.rating, w.reviews_count, w.location, w.date_of_birth,
    w.marketplace_badges, w.about, w.education, w.experience, w.skills, w.linked_profiles,
    w.created_at, w.updated_at,
    json_build_object('_id', c.id::text, 'name', c.name) AS category,
    json_build_object('_id', u.id::text, 'firstName', u.first_name, 'lastName', u.last_name,
      'email', u.email, 'role', u.role, 'avatar', u.avatar) AS user
    FROM workers w JOIN categories c ON c.id=w.category_id JOIN users u ON u.id=w.user_id
    WHERE w.id=$1`, [id]);
  if (!worker) return null;
  worker.workSamples = await rows(`SELECT id, title, sub_title, tools, client_name, delivery_date,
    project_type, preview, seller_id, created_by_user_id, created_at, updated_at
    FROM work_samples WHERE seller_id=$1`, [id]);
  return worker;
}

export async function getWorkers() {
  try {
    await dbConnect();
    const workers = await rows(`SELECT w.id, w.user_id, w.category_id, w.badge, w.status,
      w.location, w.gender, w.language, w.rating, w.reviews_count, w.created_at,
      json_build_object('_id', c.id::text, 'name', c.name) AS category,
      json_build_object('_id', u.id::text, 'firstName', u.first_name, 'lastName', u.last_name,
        'email', u.email, 'role', u.role, 'avatar', u.avatar) AS user,
      (SELECT COUNT(*)::int FROM work_samples s WHERE s.seller_id=w.id) AS work_samples_count
      FROM workers w JOIN categories c ON c.id=w.category_id JOIN users u ON u.id=w.user_id
      ORDER BY w.created_at DESC`);
    return NextResponse.json({ workers: workers.map((worker) => ({
      ...worker, workSamplesCount: worker.workSamplesCount,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleError(error, "Get workers"); }
}

export async function getWorker(req, { params }) {
  try {
    const { id } = await params;
    if (badId(id)) return fail("Invalid worker id");
    await dbConnect();
    const worker = await getFull(id);
    if (!worker) return fail("Worker not found", 404);
    return NextResponse.json({ worker }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleError(error, "Get worker"); }
}

export async function createWorker(req) {
  let avatarPath = null;
  try {
    await dbConnect();
    const { fields, workSampleIds, avatarFile } = await buildData(await req.formData());
    if (!["worker", "admin"].includes(fields.createdBy)) throw new HttpError("Created by is invalid");
    if (!["admin", "user", "worker"].includes(fields.role)) throw new HttpError("Role is invalid");
    if (!["pending", "approved", "rejected", "suspended", "reject"].includes(fields.status)) throw new HttpError("Status is invalid");
    if (avatarFile) avatarPath = await saveFile(avatarFile, "workers");
    const hashedPassword = await bcrypt.hash(fields.password, 12);
    const workerId = await withTransaction(async (client) => {
      await ensureAvailable(client, workSampleIds, null);
      const { rows: [user] } = await client.query(`INSERT INTO users
        (first_name, last_name, email, password, avatar, role)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [fields.firstName, fields.lastName, fields.email, hashedPassword, avatarPath || "", fields.role]);
      const { rows: [worker] } = await client.query(`INSERT INTO workers
        (user_id, category_id, gender, status, created_by, language, badge, location, date_of_birth,
         about, skills, marketplace_badges, education, experience, linked_profiles)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb)
        RETURNING id`,
      [user.id, fields.categoryId, fields.gender, fields.status, fields.createdBy, fields.language,
        fields.badge, fields.location, fields.dateOfBirth, fields.about, JSON.stringify(fields.skills),
        JSON.stringify(fields.marketplaceBadges), JSON.stringify(fields.education),
        JSON.stringify(fields.experience), JSON.stringify(fields.linkedProfiles)]);
      if (workSampleIds.length) {
        await client.query("UPDATE work_samples SET seller_id=$1, updated_at=NOW() WHERE id=ANY($2::int[])", [worker.id, workSampleIds]);
      }
      return worker.id;
    });
    return NextResponse.json({ message: "Worker created successfully", worker: await getFull(workerId) }, { status: 201 });
  } catch (error) {
    await removeFile(avatarPath);
    return handleError(error, "Create worker");
  }
}

export async function updateWorker(req, { params }) {
  let newAvatar = null;
  try {
    const { id } = await params;
    if (badId(id)) return fail("Invalid worker id");
    await dbConnect();
    const current = await one("SELECT id, user_id FROM workers WHERE id=$1", [id]);
    if (!current) return fail("Worker not found", 404);
    const { fields, workSampleIds, avatarFile } = await buildData(await req.formData(), { isEdit: true });
    if (!["worker", "admin"].includes(fields.createdBy)) throw new HttpError("Created by is invalid");
    if (!["admin", "user", "worker"].includes(fields.role)) throw new HttpError("Role is invalid");
    if (!["pending", "approved", "rejected", "suspended", "reject"].includes(fields.status)) throw new HttpError("Status is invalid");
    if (avatarFile) newAvatar = await saveFile(avatarFile, "workers");
    const oldAvatar = await withTransaction(async (client) => {
      await ensureAvailable(client, workSampleIds, id);
      const { rows: [user] } = await client.query(
        `SELECT id, email, avatar FROM users WHERE id=$1 FOR UPDATE`, [current.userId],
      );
      if (!user) throw new HttpError("User not found", 404);
      await client.query(`UPDATE users SET
        first_name=$2,last_name=$3,email=$4,password=COALESCE($5,password),
        role=$6,avatar=COALESCE($7,avatar),updated_at=NOW()
        WHERE id=$1 RETURNING avatar`,
      [current.userId, fields.firstName, fields.lastName, fields.email,
        fields.password ? await bcrypt.hash(fields.password, 12) : null,
        fields.role, newAvatar]);
      await client.query(`UPDATE workers SET category_id=$2,gender=$3,status=$4,created_by=$5,
        language=$6,badge=$7,location=$8,date_of_birth=$9,about=$10,skills=$11::jsonb,
        marketplace_badges=$12::jsonb,education=$13::jsonb,experience=$14::jsonb,
        linked_profiles=$15::jsonb,updated_at=NOW() WHERE id=$1`,
      [id, fields.categoryId, fields.gender, fields.status, fields.createdBy, fields.language,
        fields.badge, fields.location, fields.dateOfBirth, fields.about, JSON.stringify(fields.skills),
        JSON.stringify(fields.marketplaceBadges), JSON.stringify(fields.education),
        JSON.stringify(fields.experience), JSON.stringify(fields.linkedProfiles)]);
      await client.query(`UPDATE work_samples SET seller_id=NULL,updated_at=NOW()
        WHERE seller_id=$1 AND NOT (id=ANY($2::int[]))`, [id, workSampleIds]);
      await client.query(`UPDATE work_samples SET seller_id=$1,updated_at=NOW()
        WHERE id=ANY($2::int[])`, [id, workSampleIds]);
      return user.avatar;
    });
    if (newAvatar && oldAvatar) await removeFile(oldAvatar);
    return NextResponse.json({ message: "Seller updated", worker: await getFull(id) });
  } catch (error) {
    await removeFile(newAvatar);
    return handleError(error, "Update worker");
  }
}

export async function deleteWorker(req, { params }) {
  try {
    const { id } = await params;
    if (badId(id)) return fail("Invalid worker id");
    await dbConnect();
    const user = await withTransaction(async (client) => {
      const { rows: [worker] } = await client.query(
        "SELECT user_id FROM workers WHERE id=$1 FOR UPDATE", [id],
      );
      if (!worker) return null;
      await client.query("UPDATE work_samples SET seller_id=NULL,updated_at=NOW() WHERE seller_id=$1", [id]);
      const { rows: [deletedUser] } = await client.query("DELETE FROM users WHERE id=$1 RETURNING avatar", [worker.user_id]);
      return deletedUser;
    });
    if (!user) return fail("Worker not found", 404);
    if (user.avatar) await removeFile(user.avatar);
    return NextResponse.json({ message: "Seller deleted" });
  } catch (error) { return handleError(error, "Delete worker"); }
}

export async function updateWorkerStatus(req, { params }) {
  try {
    const { id } = await params;
    if (badId(id)) return fail("Invalid worker id");
    await dbConnect();
    const body = await req.json();
    const status = body?.status;
    if (!["pending", "approved", "reject"].includes(status)) {
      return fail("Invalid status. Status must be pending, approved or reject.");
    }
    const worker = await one("UPDATE workers SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id,status", [id, status]);
    if (!worker) return fail("Worker not found", 404);
    return NextResponse.json({ message: "Worker status updated successfully", worker: { _id: worker._id, status: worker.status } });
  } catch (error) { return handleError(error, "Update worker status"); }
}

export async function getWorkerData(id) {
  await dbConnect();
  if (badId(id)) return null;
  return getFull(id);
}

export async function getMyWorkerProfile(req, ctx, session) {
  try {
    await dbConnect();
    const worker = await one(`SELECT w.id,w.user_id,w.category_id,w.gender,w.status,w.created_by,
      w.language,w.badge,w.rating,w.reviews_count,w.location,w.date_of_birth,w.marketplace_badges,
      w.about,w.education,w.experience,w.skills,w.linked_profiles,w.created_at,w.updated_at,
      json_build_object('_id',c.id::text,'name',c.name) AS category
      FROM workers w JOIN categories c ON c.id=w.category_id WHERE w.user_id=$1`, [session.id]);
    if (!worker) return fail("Worker profile not found", 404);
    return NextResponse.json({ worker }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Get my worker profile:", error);
    return fail("Internal server error", 500);
  }
}

export async function updateMyWorkerProfile(req, ctx, session) {
  try {
    await dbConnect();
    const body = await req.json();
    const { gender, language, badge, category, location, dateOfBirth, about,
      skills, marketplaceBadges, education, experience, linkedProfiles } = body;
    if (!category) return fail("Category is required");
    if (!existsId(category)) return fail("Invalid category");
    if (!(await query("SELECT 1 FROM categories WHERE id=$1", [category])).rowCount) return fail("Category not found");
    const worker = await one(`UPDATE workers SET gender=$2,language=$3,badge=$4,category_id=$5,
      location=$6,date_of_birth=$7,about=$8,skills=$9::jsonb,marketplace_badges=$10::jsonb,
      education=$11::jsonb,experience=$12::jsonb,linked_profiles=$13::jsonb,updated_at=NOW()
      WHERE user_id=$1 RETURNING id`, [session.id, gender?.trim() || "", language?.trim() || "",
      badge?.trim() || "", category, location?.trim() || "", dateOfBirth || null,
      about?.trim() || "", JSON.stringify(Array.isArray(skills) ? skills.map((item) => item.trim()).filter(Boolean) : []),
      JSON.stringify(Array.isArray(marketplaceBadges) ? marketplaceBadges : []),
      JSON.stringify(Array.isArray(education) ? education : []),
      JSON.stringify(Array.isArray(experience) ? experience : []),
      JSON.stringify(Array.isArray(linkedProfiles) ? linkedProfiles : [])]);
    if (!worker) return fail("Worker profile not found", 404);
    const updatedWorker = await one(`SELECT w.id,w.user_id,w.category_id,w.gender,w.status,w.created_by,
      w.language,w.badge,w.rating,w.reviews_count,w.location,w.date_of_birth,w.marketplace_badges,
      w.about,w.education,w.experience,w.skills,w.linked_profiles,w.created_at,w.updated_at,
      json_build_object('_id',c.id::text,'name',c.name) AS category
      FROM workers w JOIN categories c ON c.id=w.category_id WHERE w.id=$1`, [worker._id]);
    return NextResponse.json({ message: "Worker profile updated successfully", worker: updatedWorker });
  } catch (error) {
    console.error("Update my worker profile:", error);
    return handleError(error, "Update my worker profile");
  }
}
