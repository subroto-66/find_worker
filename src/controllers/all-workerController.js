import { NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import { existsId, rows, one } from "@/lib/sql";

const workerSelect = `SELECT w.id, w.user_id, w.category_id, w.gender, w.status, w.created_by,
  w.language, w.badge, w.rating, w.reviews_count, w.location, w.date_of_birth,
  w.marketplace_badges, w.about, w.education, w.experience, w.skills, w.linked_profiles,
  w.created_at, w.updated_at,
  json_build_object('_id', c.id::text, 'name', c.name) AS category,
  json_build_object('_id', u.id::text, 'firstName', u.first_name, 'lastName', u.last_name,
    'avatar', u.avatar) AS user
  FROM workers w JOIN categories c ON c.id = w.category_id
  JOIN users u ON u.id = w.user_id`;

export async function getPublicWorkers(req) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("query");
    let sql = `${workerSelect} WHERE w.status = 'approved'`;
    if (filter === "top-rated") sql += " ORDER BY w.rating DESC, w.reviews_count DESC";
    if (filter === "top-level") {
      sql += ` AND w.badge = ANY($1::text[]) ORDER BY w.badge DESC`;
    }
    const workers = await rows(sql, filter === "top-level"
      ? [["Level 1 Seller", "Level 2 Seller", "Level 3 Seller", "Pro Seller"]]
      : []);
    return NextResponse.json({
      success: true,
      workers: workers.map((worker) => ({
        ...worker,
        firstName: worker.user?.firstName || "",
        lastName: worker.user?.lastName || "",
        avatar: worker.user?.avatar || "",
        name: [worker.user?.firstName, worker.user?.lastName].filter(Boolean).join(" "),
      })),
    });
  } catch (error) {
    console.error("Get public workers error:", error);
    return NextResponse.json({ success: false, message: "Failed to get workers" }, { status: 500 });
  }
}

export async function getPublicWorker(req, { params }) {
  try {
    const { id } = await params;
    if (!existsId(id)) {
      return NextResponse.json({ success: false, message: "Invalid worker id" }, { status: 400 });
    }
    await dbConnect();
    const worker = await one(`${workerSelect} WHERE w.id = $1 AND w.status = 'approved'`, [id]);
    if (!worker) {
      return NextResponse.json({ success: false, message: "Worker not found" }, { status: 404 });
    }
    const workSamples = await rows(`SELECT id, title, sub_title, tools, client_name,
      delivery_date, project_type, preview, seller_id, created_by_user_id, created_at, updated_at
      FROM work_samples WHERE seller_id = $1 ORDER BY created_at DESC`, [id]);
    return NextResponse.json({
      success: true,
      worker: {
        ...worker,
        firstName: worker.user?.firstName || "",
        lastName: worker.user?.lastName || "",
        avatar: worker.user?.avatar || "",
        name: [worker.user?.firstName, worker.user?.lastName].filter(Boolean).join(" "),
        workSamples,
      },
    });
  } catch (error) {
    console.error("Get public worker error:", error);
    return NextResponse.json({ success: false, message: "Failed to get worker" }, { status: 500 });
  }
}
