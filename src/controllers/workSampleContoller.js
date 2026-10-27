import { NextResponse } from "next/server";
import dbConnect, { query, withTransaction } from "@/lib/db";
import { existsId, one, rows } from "@/lib/sql";
import { hasUpload, saveFile, removeFile } from "@/lib/upload";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const fail = (message, status = 400) => NextResponse.json({ message }, { status });
const handleError = (error, label) => {
  if (error.code === "ER_NO_REFERENCED_ROW_2" || error.code === "ER_TRUNCATED_WRONG_VALUE") {
    return fail("Invalid work sample data", 400);
  }
  console.error(`${label} error:`, error);
  return fail("Internal Server error", 500);
};
const parseTools = (value) => String(value ?? "").split(",").map((tool) => tool.trim()).filter(Boolean);
const validType = (type) => type === "design" || type === "video";
const fileMatchesType = (file, type) => type === "design"
  ? file.type.startsWith("image/") : file.type.startsWith("video/");
const typeError = (type) => type === "video" ? "Please upload a video file" : "Please upload an image file";
const workColumns = `id, title, sub_title, tools, client_name, delivery_date, project_type,
  preview, seller_id, created_by_user_id, created_at, updated_at`;

async function sampleWithSeller(sample) {
  if (!sample?.sellerId) return { ...sample, seller: null };
  const seller = await one(`SELECT w.id, u.first_name, u.last_name, u.avatar
    FROM workers w JOIN users u ON u.id=w.user_id WHERE w.id=$1`, [sample.sellerId]);
  return {
    ...sample,
    seller: seller ? {
      _id: seller._id,
      name: [seller.firstName, seller.lastName].filter(Boolean).join(" "),
      avatar: seller.avatar || "",
    } : null,
  };
}

export async function createWorkSample(req) {
  let savedPath = null;
  try {
    await dbConnect();
    const form = await req.formData();
    const title = String(form.get("title") ?? "").trim();
    const subTitle = String(form.get("subTitle") ?? "").trim();
    const clientName = String(form.get("clientName") ?? "").trim();
    const deliveryDate = String(form.get("deliveryDate") ?? "").trim();
    const projectType = String(form.get("projectType") ?? "");
    const file = form.get("preview");
    if (!title) return fail("Title is required");
    if (!clientName) return fail("Client name is required");
    if (!deliveryDate || Number.isNaN(new Date(deliveryDate).getTime())) return fail("A valid delivery date is required");
    if (!validType(projectType)) return fail("Invalid project type");
    if (!hasUpload(file)) return fail("Preview file is required");
    if (file.size > MAX_FILE_SIZE) return fail("File too large (max 100MB)");
    if (!fileMatchesType(file, projectType)) return fail(typeError(projectType));
    savedPath = await saveFile(file, "work-samples");
    const sample = await one(`INSERT INTO work_samples
      (title, sub_title, tools, client_name, delivery_date, project_type, preview)
      VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7) RETURNING ${workColumns}`,
    [title, subTitle, JSON.stringify(parseTools(form.get("tools"))), clientName, deliveryDate, projectType, savedPath]);
    return NextResponse.json({ message: "Work sample created", workSample: sample }, { status: 201 });
  } catch (error) {
    await removeFile(savedPath);
    return handleError(error, "Create work sample");
  }
}

export async function getWorkSamples() {
  try {
    await dbConnect();
    const samples = await rows(`SELECT ${workColumns} FROM work_samples ORDER BY created_at DESC`);
    const workSamples = await Promise.all(samples.map(sampleWithSeller));
    return NextResponse.json({ workSamples }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "Get work samples");
  }
}

export async function getAvailableWorkSamples(req) {
  try {
    await dbConnect();
    const sellerId = new URL(req.url).searchParams.get("sellerId");
    if (sellerId && !existsId(sellerId)) return fail("Invalid seller id");
    const samples = await rows(`SELECT ${workColumns} FROM work_samples
      WHERE seller_id IS NULL OR ($1::int IS NOT NULL AND seller_id=$1)
      ORDER BY created_at DESC`, [sellerId]);
    return NextResponse.json({ workSamples: samples }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "Get available work samples");
  }
}

export async function getWorkSample(req, { params }) {
  try {
    const { id } = await params;
    if (!existsId(id)) return fail("Invalid work sample id");
    await dbConnect();
    const sample = await one(`SELECT ${workColumns} FROM work_samples WHERE id=$1`, [id]);
    if (!sample) return fail("Work sample not found", 404);
    return NextResponse.json({ workSample: await sampleWithSeller(sample) });
  } catch (error) {
    return handleError(error, "Get work sample");
  }
}

export async function updateWorkSample(req, { params }) {
  let newPath = null;
  try {
    const { id } = await params;
    if (!existsId(id)) return fail("Invalid work sample id");
    await dbConnect();
    const existing = await one(`SELECT ${workColumns} FROM work_samples WHERE id=$1`, [id]);
    if (!existing) return fail("Work sample not found", 404);
    const form = await req.formData();
    const title = form.get("title");
    const subTitle = form.get("subTitle");
    const clientName = form.get("clientName");
    const deliveryDate = form.get("deliveryDate");
    const tools = form.get("tools");
    const projectType = String(form.get("projectType") ?? existing.projectType);
    const file = form.get("preview");
    const uploadProvided = hasUpload(file);
    if (!validType(projectType)) return fail("Invalid project type");
    if (title !== null && !String(title).trim()) return fail("Title is required");
    if (projectType !== existing.projectType && !uploadProvided) return fail("Upload a new preview when changing project type");
    if (uploadProvided) {
      if (file.size > MAX_FILE_SIZE) return fail("File too large (max 100MB)");
      if (!fileMatchesType(file, projectType)) return fail(typeError(projectType));
      newPath = await saveFile(file, "work-samples");
    }
    const updated = await one(`UPDATE work_samples SET
      title=COALESCE($2,title), sub_title=COALESCE($3,sub_title),
      tools=COALESCE($4::jsonb,tools), client_name=COALESCE($5,client_name),
      delivery_date=COALESCE($6::date,delivery_date), project_type=$7,
      preview=COALESCE($8,preview), updated_at=NOW()
      WHERE id=$1 RETURNING ${workColumns}`,
    [id, title === null ? null : String(title).trim(),
      subTitle === null ? null : String(subTitle).trim(),
      tools === null ? null : JSON.stringify(parseTools(tools)),
      clientName === null ? null : String(clientName).trim(),
      deliveryDate === null ? null : String(deliveryDate), projectType, newPath]);
    if (newPath) await removeFile(existing.preview);
    return NextResponse.json({ message: "Work sample updated", workSample: updated });
  } catch (error) {
    await removeFile(newPath);
    return handleError(error, "Update work sample");
  }
}

export async function deleteWorkSample(req, { params }) {
  try {
    const { id } = await params;
    if (!existsId(id)) return fail("Invalid work sample id");
    await dbConnect();
    const sample = await one(`DELETE FROM work_samples WHERE id=$1 AND seller_id IS NULL
      RETURNING id, preview`, [id]);
    if (!sample) {
      const exists = await query("SELECT seller_id FROM work_samples WHERE id=$1", [id]);
      if (!exists.rowCount) return fail("Work sample not found", 404);
      return fail("This work sample is assigned to a seller. Remove it from the seller profile first.");
    }
    await removeFile(sample.preview);
    return NextResponse.json({ message: "Work sample deleted" });
  } catch (error) {
    return handleError(error, "Delete work sample");
  }
}

export async function getMyWorkSamples(req, ctx, user) {
  try {
    await dbConnect();
    const worker = await one("SELECT id FROM workers WHERE user_id=$1", [user.id]);
    if (!worker) return fail("Worker profile not found", 404);
    const samples = await rows(`SELECT ${workColumns} FROM work_samples
      WHERE created_by_user_id=$1 OR seller_id=$2 ORDER BY created_at DESC`, [user.id, worker._id]);
    return NextResponse.json({
      workSamples: samples.map((sample) => ({
        ...sample,
        canSelect: String(sample.createdByUserId) === String(user.id),
        selected: String(sample.sellerId) === String(worker._id),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "Get worker work samples");
  }
}

export async function createMyWorkSample(req, ctx, user) {
  let savedPath = null;
  try {
    await dbConnect();
    const worker = await one("SELECT id FROM workers WHERE user_id=$1", [user.id]);
    if (!worker) return fail("Worker profile not found", 404);
    const form = await req.formData();
    const title = String(form.get("title") ?? "").trim();
    const subTitle = String(form.get("subTitle") ?? "").trim();
    const clientName = String(form.get("clientName") ?? "").trim();
    const deliveryDate = String(form.get("deliveryDate") ?? "").trim();
    const projectType = String(form.get("projectType") ?? "");
    const file = form.get("preview");
    if (!title) return fail("Title is required");
    if (!clientName) return fail("Client name is required");
    if (!deliveryDate || Number.isNaN(new Date(deliveryDate).getTime())) return fail("A valid delivery date is required");
    if (!validType(projectType)) return fail("Invalid project type");
    if (!hasUpload(file)) return fail("Preview file is required");
    if (file.size > MAX_FILE_SIZE) return fail("File too large (max 100MB)");
    if (!fileMatchesType(file, projectType)) return fail(typeError(projectType));
    savedPath = await saveFile(file, "work-samples");
    const sample = await one(`INSERT INTO work_samples
      (title, sub_title, tools, client_name, delivery_date, project_type, preview, created_by_user_id)
      VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8) RETURNING ${workColumns}`,
    [title, subTitle, JSON.stringify(parseTools(form.get("tools"))), clientName,
      deliveryDate, projectType, savedPath, user.id]);
    return NextResponse.json({ message: "Work sample created", workSample: sample }, { status: 201 });
  } catch (error) {
    await removeFile(savedPath);
    return handleError(error, "Create worker work sample");
  }
}

export async function updateMyWorkSampleSelection(req, ctx, user) {
  try {
    await dbConnect();
    const worker = await one("SELECT id FROM workers WHERE user_id=$1", [user.id]);
    if (!worker) return fail("Worker profile not found", 404);
    let body;
    try { body = await req.json(); } catch { return fail("Invalid request body"); }
    const sampleIds = body?.sampleIds;
    if (!Array.isArray(sampleIds) || sampleIds.some((id) => !existsId(id))) {
      return fail("Work samples list is invalid");
    }
    const ids = [...new Set(sampleIds)];
    if (ids.length > 50) return fail("Too many work samples (max 50)");
    const conflict = await withTransaction(async (client) => {
      const { rows: owned } = await client.query(
        `SELECT id, seller_id FROM work_samples WHERE id=ANY($1::int[])
         AND created_by_user_id=$2 FOR UPDATE`, [ids, user.id],
      );
      if (owned.length !== ids.length) return "You can only select work samples you created";
      if (owned.some((sample) => sample.seller_id && sample.seller_id !== Number(worker._id))) {
        return "A selected work sample belongs to another worker";
      }
      await client.query(`UPDATE work_samples SET seller_id=$2, updated_at=NOW()
        WHERE id=ANY($1::int[]) AND created_by_user_id=$3`, [ids, worker._id, user.id]);
      await client.query(`UPDATE work_samples SET seller_id=NULL, updated_at=NOW()
        WHERE created_by_user_id=$1 AND seller_id=$2 AND NOT (id=ANY($3::int[]))`,
      [user.id, worker._id, ids]);
      return null;
    });
    if (conflict) return fail(conflict, conflict.includes("another worker") ? 409 : 403);
    return NextResponse.json({ message: "Work samples updated" });
  } catch (error) {
    return handleError(error, "Update worker work samples");
  }
}
