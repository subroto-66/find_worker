import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import dbConnect, { query, withTransaction } from "@/lib/db";
import { one } from "@/lib/sql";
import { signToken, setAuthCookie, getSession } from "@/lib/auth";
import { hasUpload, removeFile, saveFile } from "@/lib/upload";

export async function register(req) {
  try {
    await dbConnect();

    const {
      firstName,
      lastName,
      email,
      password,
      companyName,
      talentDomain,
      country,
      category,
      role,
    } = await req.json();

    // Basic validation
    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !email?.trim() ||
      !password ||
      password.length < 8 ||
      !["user", "worker"].includes(role)
    ) {
      return NextResponse.json(
        {
          message:
            "First name, last name, email, password and valid role are required",
        },
        { status: 400 },
      );
    }

    if (role === "worker" && !category) {
  return NextResponse.json(
    { message: "Category is required for worker registration" },
    { status: 400 },
  );
}

if (role === "worker") {
  if (typeof category !== "string" || !/^[1-9]\d*$/.test(category)) {
    return NextResponse.json({ message: "Invalid category" }, { status: 400 });
  }
  const categoryExists = await one("SELECT id FROM categories WHERE id = $1", [category]);

  if (!categoryExists) {
    return NextResponse.json(
      { message: "Invalid category" },
      { status: 400 },
    );
  }
}

    const normalizedEmail = email.toLowerCase().trim();

    // Check duplicate email
    if ((await query("SELECT 1 FROM users WHERE email = $1", [normalizedEmail])).rowCount) {
      return NextResponse.json(
        { message: "Email already exists" },
        { status: 409 },
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await withTransaction(async (client) => {
      const { rows: [createdUser] } = await client.query(
        `INSERT INTO users (first_name, last_name, email, company, talent_domain, country, password, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, first_name, last_name, email, role`,
        [firstName.trim(), lastName.trim(), normalizedEmail, companyName?.trim() || "",
          talentDomain?.trim() || "", country?.trim() || "", hashedPassword, role],
      );
      if (role === "worker") {
        await client.query(
          "INSERT INTO workers (user_id, category_id, status, created_by) VALUES ($1, $2, 'pending', 'worker')",
          [createdUser.id, category],
        );
      }
      return {
        _id: String(createdUser.id),
        firstName: createdUser.first_name,
        lastName: createdUser.last_name,
        email: createdUser.email,
        role: createdUser.role,
      };
    });

    const token = await signToken({
      id: user._id,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const res = NextResponse.json(
      {
        message: "Registered",

        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        },

        redirectTo:
          user.role === "worker" ? "/worker/dashboard" : "/",
      },
      { status: 201 },
    );

    setAuthCookie(res, token);

    return res;
  } catch (err) {
    console.error("Register error:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ message: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json(
      { message: "Internal Server error" },
      { status: 500 },
    );
  }
}
// login, logout, me: ager message er code ei file e pore add korbo

export async function login(req) {
  try {
    await dbConnect();
    const { email, password, rememberMe = true } = await req.json();

    if (!email || !password)
      return NextResponse.json(
        { message: "Email ar password Required" },
        { status: 400 },
      );

    const user = await one(
      `SELECT id, first_name, last_name, email, password, role, avatar FROM users WHERE email = $1`,
      [email.toLowerCase().trim()],
    );
    if (!user || !(await bcrypt.compare(password, user.password)))
      return NextResponse.json(
        { message: "Invalid information" },
        { status: 401 },
      );

    const token = await signToken(
      {
        id: user._id,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      rememberMe ? "30d" : "8h",
    );

    const res = NextResponse.json({
      message: "Login successful",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
      redirectTo:
        user.role === "admin"
          ? "/admin/dashboard"
          : user.role === "worker"
            ? "/worker/dashboard"
            : "/",
    });
    setAuthCookie(res, token, rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 8);
    return res;
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json(
      { message: "Internal Server error" },
      { status: 500 },
    );
  }
}

export async function updateMyAccount(req, ctx, session) {
    let newAvatar = null;
    try {
      await dbConnect();

      const user = await one(`SELECT id, first_name, last_name, email, role, avatar
        FROM users WHERE id = $1`, [session.id]);
      if (!user) {
        return NextResponse.json({ message: "User not found" }, { status: 404 });
      }

      const formData = await req.formData();
      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      const requestedEmail = String(formData.get("email") ?? "").trim().toLowerCase();
      const password = String(formData.get("password") ?? "");
      const avatar = formData.get("avatar");

      if (!firstName || firstName.length > 50) {
        return NextResponse.json(
          { message: "First name is required and must be at most 50 characters" },
          { status: 400 },
        );
      }
      if (!lastName || lastName.length > 50) {
        return NextResponse.json(
          { message: "Last name is required and must be at most 50 characters" },
          { status: 400 },
        );
      }
      if (user.role === "admin") {
        if (!requestedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
          return NextResponse.json(
            { message: "Enter a valid email address" },
            { status: 400 },
          );
        }
      }
      if (password && password.length < 8) {
        return NextResponse.json(
          { message: "Password must be at least 8 characters" },
          { status: 400 },
        );
      }

      if (hasUpload(avatar)) {
        const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!allowedTypes.includes(avatar.type)) {
          return NextResponse.json(
            { message: "Avatar must be a JPG, PNG, WEBP or GIF image" },
            { status: 400 },
          );
        }
        if (avatar.size > 5 * 1024 * 1024) {
          return NextResponse.json(
            { message: "Avatar is too large (max 5MB)" },
            { status: 400 },
          );
        }
        newAvatar = await saveFile(avatar, "workers");
      }

      const oldAvatar = user.avatar;
      const updatedUser = await one(`UPDATE users SET
        first_name = $2, last_name = $3,
        email = CASE WHEN $4 THEN $5 ELSE email END,
        password = COALESCE($6, password),
        avatar = COALESCE($7, avatar),
        updated_at = NOW()
        WHERE id = $1
        RETURNING id, first_name, last_name, email, role, avatar`,
      [user._id, firstName, lastName, user.role === "admin", requestedEmail,
        password ? await bcrypt.hash(password, 10) : null, newAvatar]);

      if (newAvatar && oldAvatar) await removeFile(oldAvatar);

      return NextResponse.json({
        message: "Profile updated successfully",
        user: {
          id: updatedUser._id,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          email: updatedUser.email,
          role: updatedUser.role,
          avatar: updatedUser.avatar || "",
        },
      });
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        if (newAvatar) await removeFile(newAvatar);
        return NextResponse.json(
          { message: "An account with this email already exists" },
          { status: 409 },
        );
      }
      if (newAvatar) await removeFile(newAvatar);
      console.error("Update account error:", err);
      return NextResponse.json(
        { message: "Failed to update profile" },
        { status: 500 },
      );
  }
}

export async function logout() {
  const res = NextResponse.json({ message: "Logged out" });
  res.cookies.set("token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function me() {
  try {
    const session = await getSession();

    const headers = {
      "Cache-Control": "no-store",
    };

    if (!session) {
      return NextResponse.json({ user: null }, { headers });
    }

    await dbConnect();

    const user = await one(`SELECT id, first_name, last_name, email, role, company,
      country, talent_domain, avatar, created_at FROM users WHERE id = $1`, [session.id]);

    if (!user) {
      return NextResponse.json({ user: null }, { headers });
    }

    let worker = null;

    if (user.role === "worker") {
      worker = await one(`SELECT w.id, w.gender, w.status, w.created_by, w.language, w.badge,
        w.category_id, w.rating, w.reviews_count, w.location, w.date_of_birth,
        w.marketplace_badges, w.about, w.education, w.experience, w.skills,
        w.linked_profiles, w.created_at,
        json_build_object('_id', c.id::text, 'name', c.name) AS category
        FROM workers w JOIN categories c ON c.id = w.category_id WHERE w.user_id = $1`,
      [user._id]);
    }

    return NextResponse.json(
      {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          avatar: user.avatar || "",
          company: user.company || null,
          country: user.country || null,
          talentDomain: user.talentDomain || null,
          createdAt: user.createdAt,

          ...(user.role === "worker"
            ? {
                worker,
              }
            : {}),
        },
      },
      { headers },
    );
  } catch (err) {
    console.error("Me error:", err);

    return NextResponse.json(
      { user: null },
      { status: 500 },
    );
  }
}
