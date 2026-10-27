import { NextResponse } from "next/server";
import dbConnect, { withTransaction } from "@/lib/db";
import { existsId, rows } from "@/lib/sql";
import { withAuth } from "@/lib/withAuth";
import { removeFile } from "@/lib/upload";

async function getClients() {
  try {
    await dbConnect();
    const clients = await rows(`SELECT id, first_name, last_name, email, avatar, company,
      country, talent_domain, created_at FROM users WHERE role = 'user' ORDER BY created_at DESC`);

    return NextResponse.json(
      { clients },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Get admin clients error:", error);
    return NextResponse.json(
      { message: "Failed to load clients" },
      { status: 500 },
    );
  }
}

export const GET = withAuth(getClients, ["admin"]);

async function deleteClient(req, { params }) {
  try {
    const { id } = await params;
    if (!existsId(id)) {
      return NextResponse.json({ message: "Invalid client id" }, { status: 400 });
    }

    await dbConnect();
    const client = await withTransaction(async (db) => {
      const { rows: affected } = await db.query("SELECT DISTINCT worker_id FROM reviews WHERE user_id = $1", [id]);
      const { rows: [deleted] } = await db.query(
        "DELETE FROM users WHERE id = $1 AND role = 'user' RETURNING id, avatar",
        [id],
      );
      if (!deleted) return null;
      const workerIds = affected.map(({ worker_id }) => worker_id);
      if (workerIds.length) {
        await db.query(`UPDATE workers w SET
          rating = COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 1) FROM reviews r WHERE r.worker_id=w.id), 0),
          reviews_count = (SELECT COUNT(*)::int FROM reviews r WHERE r.worker_id=w.id),
          updated_at = NOW()
          WHERE w.id = ANY($1::int[])`, [workerIds]);
      }
      return deleted;
    });
    if (!client) {
      return NextResponse.json({ message: "Client not found" }, { status: 404 });
    }

    await removeFile(client.avatar);

    return NextResponse.json({ message: "Client deleted" });
  } catch (error) {
    console.error("Delete admin client error:", error);
    return NextResponse.json({ message: "Failed to delete client" }, { status: 500 });
  }
}

export const DELETE = withAuth(deleteClient, ["admin"]);
