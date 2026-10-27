import { NextResponse } from "next/server";
import DOMPurify from "isomorphic-dompurify";
import dbConnect, { query } from "@/lib/db";
import { existsId, one, rows } from "@/lib/sql";
import { hasUpload, removeFile, saveFile } from "@/lib/upload";

const fail = (message, status = 400) => NextResponse.json({ message }, { status });
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const blogColumns = `id, title, subtitle, slug, content, category, author_name, author_role,
  author_avatar, image, comments_enabled, created_at, updated_at`;

function createSlug(title) {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}

function getBlogFields(formData) {
  const content = String(formData.get("content") ?? "").trim();
  return {
    title: String(formData.get("title") ?? "").trim(),
    subtitle: String(formData.get("subtitle") ?? "").trim(),
    content: DOMPurify.sanitize(content, { USE_PROFILES: { html: true } }),
    category: String(formData.get("category") ?? "").trim(),
    authorName: String(formData.get("authorName") ?? "").trim(),
    authorRole: String(formData.get("authorRole") ?? "").trim(),
    commentsEnabled: formData.get("commentsEnabled") === "true",
  };
}

function validateFields(fields) {
  for (const field of ["title", "subtitle", "content", "category", "authorName", "authorRole"]) {
    if (!fields[field]) return `${field[0].toUpperCase()}${field.slice(1)} is required`;
  }
  const contentText = fields.content.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  if (!contentText && !/<img\b/i.test(fields.content)) return "Article content is required";
  return null;
}

function handleError(error, label) {
  if (error.code === "ER_DUP_ENTRY") return fail("A blog with this title already exists", 409);
  if (error.name === "ValidationError" || error.name === "CastError") return fail(error.message);
  console.error(`${label} error:`, error);
  return fail("Internal server error", 500);
}

export async function listAdminBlogs() {
  try {
    await dbConnect();
    const blogs = await rows(`SELECT ${blogColumns} FROM blogs ORDER BY created_at DESC`);
    return NextResponse.json({ blogs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "List blogs");
  }
}

export async function createBlog(req) {
  let imagePath = null;
  let avatarPath = null;
  try {
    await dbConnect();
    const formData = await req.formData();
    const fields = getBlogFields(formData);
    const validationError = validateFields(fields);
    if (validationError) return fail(validationError);
    const image = formData.get("image");
    const authorAvatar = formData.get("authorAvatar");
    if (!hasUpload(image)) return fail("Blog image is required");
    if (!image.type.startsWith("image/")) return fail("Blog image must be an image file");
    if (image.size > MAX_IMAGE_SIZE) return fail("Blog image must be 10MB or smaller");
    if (hasUpload(authorAvatar)) {
      if (!authorAvatar.type.startsWith("image/")) return fail("Author avatar must be an image file");
      if (authorAvatar.size > MAX_IMAGE_SIZE) return fail("Author avatar must be 10MB or smaller");
    }
    imagePath = await saveFile(image, "blogs");
    if (hasUpload(authorAvatar)) avatarPath = await saveFile(authorAvatar, "blogs");
    const baseSlug = createSlug(fields.title) || "blog";
    let slug = baseSlug;
    let suffix = 2;
    while ((await query("SELECT 1 FROM blogs WHERE slug = $1", [slug])).rowCount) {
      slug = `${baseSlug}-${suffix++}`;
    }
    const blog = await one(`INSERT INTO blogs
      (title, subtitle, slug, content, category, author_name, author_role, author_avatar, image, comments_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${blogColumns}`,
    [fields.title, fields.subtitle, slug, fields.content, fields.category, fields.authorName,
      fields.authorRole, avatarPath || "", imagePath, fields.commentsEnabled]);
    return NextResponse.json({ blog }, { status: 201 });
  } catch (error) {
    await Promise.all([removeFile(imagePath), removeFile(avatarPath)]);
    return handleError(error, "Create blog");
  }
}

export async function updateBlog(req, { params }) {
  let newImagePath = null;
  let newAvatarPath = null;
  let previousImage = null;
  let previousAvatar = null;
  try {
    await dbConnect();
    const { id } = await params;
    if (!existsId(id)) return fail("Invalid blog id", 400);
    const blog = await one(`SELECT ${blogColumns} FROM blogs WHERE id = $1`, [id]);
    if (!blog) return fail("Blog not found", 404);
    previousImage = blog.image;
    previousAvatar = blog.authorAvatar;
    const formData = await req.formData();
    const fields = getBlogFields(formData);
    const validationError = validateFields(fields);
    if (validationError) return fail(validationError);
    const image = formData.get("image");
    const authorAvatar = formData.get("authorAvatar");
    if (hasUpload(image)) {
      if (!image.type.startsWith("image/")) return fail("Blog image must be an image file");
      if (image.size > MAX_IMAGE_SIZE) return fail("Blog image must be 10MB or smaller");
      newImagePath = await saveFile(image, "blogs");
    }
    if (hasUpload(authorAvatar)) {
      if (!authorAvatar.type.startsWith("image/")) return fail("Author avatar must be an image file");
      if (authorAvatar.size > MAX_IMAGE_SIZE) return fail("Author avatar must be 10MB or smaller");
      newAvatarPath = await saveFile(authorAvatar, "blogs");
    }
    const updated = await one(`UPDATE blogs SET title=$2, subtitle=$3, content=$4, category=$5,
      author_name=$6, author_role=$7, comments_enabled=$8,
      image=COALESCE($9,image), author_avatar=COALESCE($10,author_avatar), updated_at=NOW()
      WHERE id=$1 RETURNING ${blogColumns}`,
    [id, fields.title, fields.subtitle, fields.content, fields.category, fields.authorName,
      fields.authorRole, fields.commentsEnabled, newImagePath, newAvatarPath]);
    if (newImagePath) await removeFile(previousImage);
    if (newAvatarPath) await removeFile(previousAvatar);
    return NextResponse.json({ blog: updated });
  } catch (error) {
    await Promise.all([removeFile(newImagePath), removeFile(newAvatarPath)]);
    return handleError(error, "Update blog");
  }
}

export async function deleteBlog(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;
    if (!existsId(id)) return fail("Invalid blog id", 400);
    const blog = await one(`DELETE FROM blogs WHERE id = $1 RETURNING id, image, author_avatar`, [id]);
    if (!blog) return fail("Blog not found", 404);
    await Promise.all([removeFile(blog.image), removeFile(blog.authorAvatar)]);
    return NextResponse.json({ message: "Blog deleted" });
  } catch (error) {
    return handleError(error, "Delete blog");
  }
}

export async function getPublicBlogs() {
  try {
    await dbConnect();
    const blogs = await rows(`SELECT id, title, subtitle, slug, category, author_name, author_role,
      author_avatar, image, comments_enabled, created_at, updated_at
      FROM blogs ORDER BY created_at DESC`);
    return NextResponse.json({ blogs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "Get public blogs");
  }
}

export async function getPublicBlog(req, { params }) {
  try {
    await dbConnect();
    const { slug } = await params;
    const blog = await one(`SELECT ${blogColumns} FROM blogs WHERE slug = $1`, [slug]);
    if (!blog) return fail("Blog not found", 404);
    const comments = await rows(`SELECT c.id, c.blog_id, c.user_id, c.author_name,
      c.author_avatar, c.author_role, c.content, c.created_at, c.updated_at
      FROM blog_comments c WHERE c.blog_id = $1 ORDER BY c.created_at DESC`, [blog._id]);
    return NextResponse.json({ blog, comments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error, "Get public blog");
  }
}

export async function createBlogComment(req, { params }, authUser) {
  try {
    await dbConnect();
    const { slug } = await params;
    const blog = await one("SELECT id, comments_enabled FROM blogs WHERE slug = $1", [slug]);
    if (!blog) return fail("Blog not found", 404);
    if (!blog.commentsEnabled) return fail("Comments are disabled for this blog", 403);
    const body = await req.json();
    const content = String(body.content ?? "").trim();
    if (!content) return fail("Comment is required");
    if (content.length > 2000) return fail("Comment must be 2,000 characters or fewer");
    const user = await one("SELECT id, first_name, last_name, avatar, role FROM users WHERE id = $1", [authUser.id]);
    if (!user) return fail("User not found", 401);
    const comment = await one(`INSERT INTO blog_comments
      (blog_id, user_id, author_name, author_avatar, author_role, content)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, blog_id, user_id, author_name, author_avatar, author_role, content, created_at, updated_at`,
    [blog._id, user._id, `${user.firstName} ${user.lastName}`.trim(), user.avatar || "", user.role, content]);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return handleError(error, "Create blog comment");
  }
}
