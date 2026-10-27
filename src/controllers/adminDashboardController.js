import { NextResponse } from "next/server";
import dbConnect, { query } from "@/lib/db";
import { rows } from "@/lib/sql";

export async function getAdminDashboardStats() {
  try {
    await dbConnect();

    const [
      { rows: [stats] },
      { rows: roleCounts },
      topFreelancers,
      monthlySignups,
    ] = await Promise.all([
      query(`SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user')::int AS total_users,
        (SELECT COUNT(*) FROM workers)::int AS total_freelancers,
        (SELECT COUNT(*) FROM workers WHERE status = 'approved')::int AS approved_freelancers,
        (SELECT COUNT(*) FROM workers WHERE status = 'pending')::int AS pending_freelancers,
        (SELECT COUNT(*) FROM work_samples)::int AS total_work_samples,
        (SELECT COUNT(*) FROM categories)::int AS total_categories,
        (SELECT COUNT(*) FROM blogs)::int AS total_blogs`),
      query("SELECT role, COUNT(*)::int AS count FROM users GROUP BY role"),
      rows(`SELECT w.id, w.rating, w.reviews_count, w.badge,
        u.first_name, u.last_name, u.avatar
        FROM workers w JOIN users u ON u.id = w.user_id
        WHERE w.status = 'approved'
        ORDER BY w.rating DESC, w.reviews_count DESC, w.created_at DESC LIMIT 5`),
      getMonthlySignups(),
    ]);

    const usersByRole = { admin: 0, user: 0, worker: 0 };
    roleCounts.forEach(({ role, count }) => {
      if (role in usersByRole) usersByRole[role] = count;
    });

    return NextResponse.json({
      stats: {
        totalUsers: stats.total_users,
        totalFreelancers: stats.total_freelancers,
        approvedFreelancers: stats.approved_freelancers,
        pendingFreelancers: stats.pending_freelancers,
        totalWorkSamples: stats.total_work_samples,
        totalCategories: stats.total_categories,
        totalBlogs: stats.total_blogs,
      },
      usersByRole,
      monthlySignups,
      topFreelancers: topFreelancers.map((worker) => ({
        _id: worker._id,
        name: [worker.firstName, worker.lastName].filter(Boolean).join(" ") || "Unnamed Freelancer",
        avatar: worker.avatar || "",
        rating: Number(worker.rating) || 0,
        reviewsCount: worker.reviewsCount || 0,
        badge: worker.badge || "",
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Get admin dashboard stats error:", error);
    return NextResponse.json({ message: "Failed to load dashboard statistics" }, { status: 500 });
  }
}

async function getMonthlySignups() {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      start: date,
      end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
      month: date.toLocaleString("en-US", { month: "short" }),
    };
  });

  return Promise.all(months.map(async ({ start, end, month }) => {
    const { rows: [result] } = await query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'user' AND created_at >= $1 AND created_at < $2",
      [start, end],
    );
    return { month, count: result.count };
  }));
}
