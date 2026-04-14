// src/middleware/botRenderer.middleware.js
//
// Detects social/search crawlers by User-Agent.
// If a bot hits /meta/article/:slug or /meta/category/:slug,
// fetch the real data from the DB and return a thin HTML page
// with correct OG/Twitter meta tags — no React needed.
//
// Normal users never hit these routes (vercel.json only proxies bots here).

import sql from "../config/database.js";
//import { errorResponse } from "../utils/response.js";
import 'dotenv/config';

const SITE_URL = process.env.FRONTEND_URL; // Update when domain is finalised
const SITE_NAME = "Mango People News";
const DEFAULT_DESCRIPTION =
  "India's financial and business news platform. Markets, economy, policy and more. News for Every Indian.";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Returns a minimal HTML document with only <head> meta tags.
 * Bots only read <head> — no need to render the full React app.
 * Includes a redirect so if a real user somehow lands here they
 * get bounced to the real SPA page immediately.
 */
function buildMetaHtml({ title, description, ogImage, ogType, canonicalUrl, article }) {
  const fullTitle = title
    ? `${title} — ${SITE_NAME}`
    : `${SITE_NAME} — News for Every Indian`;

  const resolvedImage = ogImage || DEFAULT_OG_IMAGE;

  const articleMeta =
    ogType === "article" && article
      ? `
    <meta property="article:published_time" content="${article.publishedTime || ""}" />
    <meta property="article:modified_time" content="${article.modifiedTime || ""}" />
    <meta property="article:author" content="${article.authorName || SITE_NAME}" />
    <meta property="article:section" content="${article.section || ""}" />`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${fullTitle}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />

  <!-- Open Graph -->
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${escapeAttr(fullTitle)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:image" content="${resolvedImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${escapeAttr(fullTitle)}" />
  <meta property="og:locale" content="en_IN" />
  ${articleMeta}

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@mangopeoplenews" />
  <meta name="twitter:title" content="${escapeAttr(fullTitle)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image" content="${resolvedImage}" />

  <!-- Redirect real users to the SPA immediately -->
  <meta http-equiv="refresh" content="0;url=${canonicalUrl}" />
  <script>window.location.replace("${canonicalUrl}");</script>
</head>
<body></body>
</html>`;
}

/** Escape double-quotes in HTML attribute values */
function escapeAttr(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─────────────────────────────────────────────────────────────
//  Route Handlers
// ─────────────────────────────────────────────────────────────

/**
 * GET /meta/article/:slug
 * Called only by bots (via vercel.json rewrite).
 * Fetches article + author + category from DB and returns OG HTML.
 */
export async function renderArticleMeta(req, res) {
  const { slug } = req.params;

  try {
    const rows = await sql`
      SELECT
        a.title,
        a.excerpt,
        a.cover_image,
        a.published_at,
        a.updated_at,
        u.full_name   AS author_name,
        c.name        AS category_name
      FROM articles a
      LEFT JOIN users u ON u.id = a.author_id
      LEFT JOIN categories c ON c.id = a.category_id
      WHERE a.slug = ${slug}
        AND a.status = 'published'
      LIMIT 1
    `;

    if (!rows.length) {
      // Article not found — return default site meta so the link
      // still shows something sensible when shared
      return res.status(200).send(
        buildMetaHtml({
          title: null,
          description: DEFAULT_DESCRIPTION,
          ogImage: DEFAULT_OG_IMAGE,
          ogType: "website",
          canonicalUrl: SITE_URL,
          article: null,
        })
      );
    }

    const row = rows[0];

    const html = buildMetaHtml({
      title: row.title,
      description: row.excerpt || DEFAULT_DESCRIPTION,
      ogImage: row.cover_image || DEFAULT_OG_IMAGE,
      ogType: "article",
      canonicalUrl: `${SITE_URL}/article/${slug}`,
      article: {
        publishedTime: row.published_at,
        modifiedTime: row.updated_at,
        authorName: row.author_name,
        section: row.category_name,
      },
    });

    // Cache for 10 minutes — articles don't change that fast
    res.setHeader("Cache-Control", "public, max-age=600, stale-while-revalidate=60");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("[botRenderer] article meta error:", err);
    return next()
  }
}

/**
 * GET /meta/category/:slug
 * Renders OG meta for category pages.
 */
export async function renderCategoryMeta(req, res) {
  const { slug } = req.params;

  try {
    const rows = await sql`
      SELECT name, description
      FROM categories
      WHERE slug = ${slug}
      LIMIT 1
    `;

    if (!rows.length) {
      return res.status(200).send(
        buildMetaHtml({
          title: null,
          description: DEFAULT_DESCRIPTION,
          ogImage: DEFAULT_OG_IMAGE,
          ogType: "website",
          canonicalUrl: SITE_URL,
          article: null,
        })
      );
    }

    const row = rows[0];

    const html = buildMetaHtml({
      title: `${row.name} News`,
      description:
        row.description ||
        `Latest ${row.name} news and updates — ${SITE_NAME}`,
      ogImage: DEFAULT_OG_IMAGE,
      ogType: "website",
      canonicalUrl: `${SITE_URL}/category/${slug}`,
      article: null,
    });

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("[botRenderer] category meta error:", err);
    return next()
  }
}