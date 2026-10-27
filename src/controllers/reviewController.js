import { NextResponse } from "next/server";
import dbConnect, { query } from "@/lib/db";
import { existsId, one, rows } from "@/lib/sql";

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const fail = (message, status = 400) => NextResponse.json({ message }, { status });
const handleError = (err, label) => {
  if (err instanceof HttpError) return fail(err.message, err.status);
  if (err.code === "ER_DUP_ENTRY") return fail("You have already reviewed this worker", 409);
  console.error(`${label} error:`, err);
  return fail("Internal Server error", 500);
};
const badId = (id) => !existsId(id);
const getRating = (value) => {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError("Rating must be between 1 and 5");
  return rating;
};
const getComment = (value) => {
  const comment = typeof value === "string" ? value.trim() : "";
  if (!comment) throw new HttpError("Comment is required");
  if (comment.length > 2000) throw new HttpError("Comment is too long (max 2000 characters)");
  return comment;
};

const reviewSelect = `SELECT r.id, r.worker_id, r.user_id, r.rating, r.comment, r.created_at, r.updated_at,
  json_build_object('_id', u.id::text, 'firstName', u.first_name, 'lastName', u.last_name,
    'avatar', u.avatar) AS user
  FROM reviews r JOIN users u ON u.id = r.user_id`;
const workerSelect = `SELECT w.id, w.category_id, w.rating, w.reviews_count,
  json_build_object('_id', c.id::text, 'name', c.name) AS category,
  json_build_object('_id', u.id::text, 'firstName', u.first_name, 'lastName', u.last_name,
    'avatar', u.avatar) AS user
  FROM workers w JOIN categories c ON c.id = w.category_id
  JOIN users u ON u.id = w.user_id`;

function breakdown(distribution, totalReviews) {
  const ratingCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  distribution.forEach(({ rating, count }) => { ratingCounts[rating] = count; });
  return [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratingCounts[star],
    percentage: totalReviews ? Math.round((ratingCounts[star] / totalReviews) * 100) : 0,
  }));
}

export async function getWorkerReviews(req, { params }) {
  try {
    const { id } = await params;
    if (badId(id)) return fail("Invalid worker id");
    await dbConnect();
    const worker = await one("SELECT id, rating, reviews_count, status FROM workers WHERE id=$1", [id]);
    if (!worker || worker.status !== "approved") return fail("Worker not found", 404);
    const [reviews, distributionResult] = await Promise.all([
      rows(`${reviewSelect} WHERE r.worker_id=$1 ORDER BY r.created_at DESC`, [id]),
      query("SELECT rating, COUNT(*)::int AS count FROM reviews WHERE worker_id=$1 GROUP BY rating", [id]),
    ]);
    return NextResponse.json({
      worker: { rating: Number(worker.rating), reviewsCount: worker.reviewsCount },
      reviews,
      ratingBreakdown: breakdown(distributionResult.rows, reviews.length),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "Get worker reviews");
  }
}

export async function createWorkerReview(req, { params }, user) {
  try {
    const { id } = await params;
    if (badId(id)) return fail("Invalid worker id");
    if (!user?.id) return fail("Unauthorized", 401);
    await dbConnect();
    const worker = await one("SELECT id, user_id, status FROM workers WHERE id=$1", [id]);
    if (!worker || worker.status !== "approved") return fail("Worker not found", 404);
    if (user.role === "worker" && String(worker.userId) === String(user.id)) {
      return fail("You cannot review your own profile", 403);
    }
    let body;
    try { body = await req.json(); } catch { throw new HttpError("Invalid request body"); }
    const rating = getRating(body.rating);
    const comment = getComment(body.comment);
    const review = await one(`INSERT INTO reviews (worker_id, user_id, rating, comment)
      VALUES ($1,$2,$3,$4)
      RETURNING id, worker_id, user_id, rating, comment, created_at, updated_at`,
    [id, user.id, rating, comment]);
    await updateWorkerRating(id);
    const populatedReview = await one(`${reviewSelect} WHERE r.id=$1`, [review._id]);
    return NextResponse.json({ message: "Review posted successfully", review: populatedReview }, { status: 201 });
  } catch (error) {
    return handleError(error, "Create worker review");
  }
}

async function updateWorkerRating(workerId) {
  await query(`UPDATE workers w SET
    rating = COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 1) FROM reviews r WHERE r.worker_id=w.id), 0),
    reviews_count = (SELECT COUNT(*)::int FROM reviews r WHERE r.worker_id=w.id),
    updated_at = NOW()
    WHERE w.id=$1`, [workerId]);
}

export async function getAdminReviews(req) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const workerId = searchParams.get("workerId");
    const workers = await rows(`${workerSelect} ORDER BY w.created_at DESC`);
    const formattedWorkers = workers.map((worker) => ({
      ...worker,
      name: [worker.user?.firstName, worker.user?.lastName].filter(Boolean).join(" "),
      avatar: worker.user?.avatar || "",
    }));
    if (!workerId) {
      return NextResponse.json({
        workers: formattedWorkers, selectedWorker: null, reviews: [], ratingBreakdown: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (badId(workerId)) return fail("Invalid worker id");
    const selectedWorker = await one(`${workerSelect} WHERE w.id=$1`, [workerId]);
    if (!selectedWorker) return fail("Worker not found", 404);
    selectedWorker.name = [selectedWorker.user?.firstName, selectedWorker.user?.lastName].filter(Boolean).join(" ");
    selectedWorker.avatar = selectedWorker.user?.avatar || "";
    const [reviews, distributionResult] = await Promise.all([
      rows(`${reviewSelect} WHERE r.worker_id=$1 ORDER BY r.created_at DESC`, [workerId]),
      query("SELECT rating, COUNT(*)::int AS count FROM reviews WHERE worker_id=$1 GROUP BY rating", [workerId]),
    ]);
    return NextResponse.json({
      workers: formattedWorkers,
      selectedWorker,
      reviews,
      ratingBreakdown: breakdown(distributionResult.rows, reviews.length),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "Get admin reviews");
  }
}

export async function deleteReview(req, { params }) {
  try {
    const { id } = await params;
    if (badId(id)) return fail("Invalid review id");
    await dbConnect();
    const review = await one("DELETE FROM reviews WHERE id=$1 RETURNING worker_id", [id]);
    if (!review) return fail("Review not found", 404);
    await updateWorkerRating(review.workerId);
    return NextResponse.json({ message: "Review deleted successfully" });
  } catch (error) {
    return handleError(error, "Delete review");
  }
}
