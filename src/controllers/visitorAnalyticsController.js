import { NextResponse } from "next/server";
import { isIP } from "node:net";
import dbConnect from "@/lib/db";
import { query } from "@/lib/db";
import { existsId, rows } from "@/lib/sql";

const stringValue = (value, max = 300) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const numberValue = (value, max) =>
  Number.isInteger(value) && value >= 0 && value <= max ? value : null;

function detectBrowser(userAgent) {
  if (/Edg\//i.test(userAgent)) return "Microsoft Edge";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/CriOS|Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Unknown";
}

function detectOS(userAgent) {
  if (/Windows NT/i.test(userAgent)) return "Windows";
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Mac OS X/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Unknown";
}

function detectDevice(userAgent) {
  if (/iPad|Tablet/i.test(userAgent)) return "Tablet";
  if (/Mobile|Android|iPhone|iPod/i.test(userAgent)) return "Mobile";
  return "Desktop";
}

function getRequestIp(req) {
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("true-client-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0],
    req.headers.get("forwarded")?.match(/for=(?:"?\[?)([0-9a-f:.]+)/i)?.[1],
  ];

  for (const candidate of candidates) {
    const ip = candidate?.trim().replace(/^\[|\]$/g, "");
    if (ip && isIP(ip)) return ip;
  }

  return "";
}

export async function recordConsentedVisit(req) {
  try {
    if (req.cookies.get("analytics_consent")?.value !== "accepted") {
      return NextResponse.json({ message: "Analytics consent is required" }, { status: 403 });
    }

    const body = await req.json();
    const sessionId = stringValue(body.sessionId, 80);
    const pagePath = stringValue(body.path, 500);
    if (!/^[a-f0-9-]{16,80}$/i.test(sessionId)) {
      return NextResponse.json({ message: "Invalid analytics session" }, { status: 400 });
    }
    if (!pagePath.startsWith("/") || pagePath.startsWith("//")) {
      return NextResponse.json({ message: "Invalid page path" }, { status: 400 });
    }

    const userAgent = stringValue(body.userAgent, 500);
    const now = new Date();
    const page = {
      path: pagePath,
      visitedAt: now,
      referrer: stringValue(body.referrer, 500),
    };
    const analytics = {
      browser: detectBrowser(userAgent),
      operatingSystem: detectOS(userAgent),
      deviceType: detectDevice(userAgent),
      ipAddress: getRequestIp(req),
      language: stringValue(body.language, 40),
      languages: Array.isArray(body.languages)
        ? body.languages.filter((language) => typeof language === "string").slice(0, 10).map((language) => stringValue(language, 40))
        : [],
      timezone: stringValue(body.timezone, 100),
      platform: stringValue(body.platform, 100),
      screen: {
        width: numberValue(body.screen?.width, 20000),
        height: numberValue(body.screen?.height, 20000),
        colorDepth: numberValue(body.screen?.colorDepth, 128),
      },
      viewport: {
        width: numberValue(body.viewport?.width, 20000),
        height: numberValue(body.viewport?.height, 20000),
      },
    };

    await dbConnect();
    await query(
      `INSERT INTO visitor_analytics (
        session_id, first_seen_at, last_seen_at, page_views, pages, browser,
        operating_system, device_type, ip_address, language, languages, timezone,
        screen, viewport, platform
      ) VALUES ($1, $2, $2, 1, JSON_ARRAY(CAST($3 AS JSON)), $4, $5, $6, $7, $8,
        CAST($9 AS JSON), $10, CAST($11 AS JSON), CAST($12 AS JSON), $13)
      ON DUPLICATE KEY UPDATE
        last_seen_at = VALUES(last_seen_at),
        page_views = visitor_analytics.page_views + 1,
        pages = CASE
          WHEN JSON_LENGTH(visitor_analytics.pages) >= 100
            THEN JSON_ARRAY_APPEND(JSON_REMOVE(visitor_analytics.pages, '$[0]'), '$', JSON_EXTRACT(VALUES(pages), '$[0]'))
          ELSE JSON_ARRAY_APPEND(visitor_analytics.pages, '$', JSON_EXTRACT(VALUES(pages), '$[0]'))
        END,
        browser = VALUES(browser),
        operating_system = VALUES(operating_system),
        device_type = VALUES(device_type),
        ip_address = VALUES(ip_address),
        language = VALUES(language),
        languages = VALUES(languages),
        timezone = VALUES(timezone),
        screen = VALUES(screen),
        viewport = VALUES(viewport),
        platform = VALUES(platform),
        updated_at = NOW()`,
      [
        sessionId,
        now,
        JSON.stringify(page),
        analytics.browser,
        analytics.operatingSystem,
        analytics.deviceType,
        analytics.ipAddress,
        analytics.language,
        JSON.stringify(analytics.languages),
        analytics.timezone,
        JSON.stringify(analytics.screen),
        JSON.stringify(analytics.viewport),
        analytics.platform,
      ],
    );
    return NextResponse.json({ recorded: true }, { status: 202 });
  } catch (error) {
    console.error("Record visitor analytics error:", error);
    return NextResponse.json({ message: "Failed to record visit" }, { status: 500 });
  }
}

export async function getVisitorAnalytics() {
  try {
    await dbConnect();
    const [visitors, totalsResult] = await Promise.all([
      rows(`SELECT id, session_id, first_seen_at, last_seen_at, page_views, pages, browser,
        operating_system, device_type, ip_address, language, languages, timezone, screen,
        viewport, platform, created_at, updated_at
        FROM visitor_analytics ORDER BY last_seen_at DESC LIMIT 500`),
      query("SELECT COUNT(*)::int AS visitors, COALESCE(SUM(page_views), 0)::int AS page_views FROM visitor_analytics"),
    ]);
    const totals = totalsResult.rows[0];
    return NextResponse.json({
      visitors,
      totals: { visitors: totals.visitors, pageViews: totals.page_views },
      limit: 500,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Get visitor analytics error:", error);
    return NextResponse.json({ message: "Failed to load visitor analytics" }, { status: 500 });
  }
}

export async function deleteVisitorAnalytics(req, { params }) {
  try {
    const { id } = await params;
    if (!existsId(id)) {
      return NextResponse.json({ message: "Invalid visitor record id" }, { status: 400 });
    }

    await dbConnect();
    const result = await query("DELETE FROM visitor_analytics WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) {
      return NextResponse.json({ message: "Visitor record not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Visitor record deleted" });
  } catch (error) {
    console.error("Delete visitor analytics error:", error);
    return NextResponse.json({ message: "Failed to delete visitor record" }, { status: 500 });
  }
}
