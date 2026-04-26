// src/middleware/botRenderer.middleware.js
import sql from "../config/database.js";
import 'dotenv/config';

const SITE_URL = process.env.FRONTEND_URL;
const SITE_NAME = "Mango People News";
const DEFAULT_DESCRIPTION =
  "India's financial and business news platform. Markets, economy, policy and more. News for Every Indian.";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

function escapeAttr(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMetaHtml({ title, description, ogImage, ogType, canonicalUrl, article }) {
  const fullTitle = title
    ? `${title} — ${SITE_NAME}`
    : `${SITE_NAME} — News for Every Indian`;

  const resolvedImage = ogImage?.startsWith('http')
    ? ogImage
    : ogImage
      ? `${SITE_URL}${ogImage}`
      : DEFAULT_OG_IMAGE;

  const articleMeta = ogType === "article" && article ? `
    <meta property="article:published_time" content="${escapeAttr(article.publishedTime || "")}" />
    <meta property="article:modified_time"  content="${escapeAttr(article.modifiedTime  || "")}" />
    <meta property="article:author"         content="${escapeAttr(article.authorName    || SITE_NAME)}" />
    <meta property="article:section"        content="${escapeAttr(article.section       || "")}" />` : "";

  // canonicalUrl here is the REAL SPA page (e.g. https://yoursite.com/article/slug)
  // NOT the /meta/ endpoint — so the redirect sends users to the right place
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeAttr(fullTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />

  <meta property="og:type"         content="${ogType}" />
  <meta property="og:site_name"    content="${SITE_NAME}" />
  <meta property="og:title"        content="${escapeAttr(fullTitle)}" />
  <meta property="og:description"  content="${escapeAttr(description)}" />
  <meta property="og:url"          content="${canonicalUrl}" />
  <meta property="og:image"        content="${resolvedImage}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt"    content="${escapeAttr(fullTitle)}" />
  <meta property="og:locale"       content="en_IN" />
  ${articleMeta}

  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:site"        content="@mangopeoplenews" />
  <meta name="twitter:title"       content="${escapeAttr(fullTitle)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image"       content="${resolvedImage}" />

  <meta http-equiv="refresh" content="0;url=${canonicalUrl}" />
  <script>window.location.replace(${JSON.stringify(canonicalUrl)});</script>
</head>
<body></body>
</html>`;
}

// Called for /article/:slug bot hits
export async function renderArticleMeta(req, res, next) {  // ← add next
  const { slug } = req.params;
  try {
    const rows = await sql`
      SELECT
        a.title, a.excerpt, a.cover_image,
        a.published_at, a.updated_at,
        u.full_name AS author_name,
        c.name      AS category_name
      FROM articles a
      LEFT JOIN users      u ON u.id = a.author_id
      LEFT JOIN categories c ON c.id = a.category_id
      WHERE a.slug = ${slug} AND a.status = 'published'
      LIMIT 1
    `;

    const canonicalUrl = `${SITE_URL}/article/${slug}`;

    if (!rows.length) {
      // Unknown slug — still return valid OG so shared links don't look broken
      return res.status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "public, max-age=60")
        .send(buildMetaHtml({
          title: null,
          description: DEFAULT_DESCRIPTION,
          ogImage: DEFAULT_OG_IMAGE,
          ogType: "website",
          canonicalUrl: SITE_URL,
          article: null,
        }));
    }

    const row = rows[0];
    return res.status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=600, stale-while-revalidate=60")
      .send(buildMetaHtml({
        title:       row.title,
        description: row.excerpt || DEFAULT_DESCRIPTION,
        ogImage:     row.cover_image || DEFAULT_OG_IMAGE,
        ogType:      "article",
        canonicalUrl,
        article: {
          publishedTime: row.published_at,
          modifiedTime:  row.updated_at,
          authorName:    row.author_name,
          section:       row.category_name,
        },
      }));
  } catch (err) {
    console.error("[botRenderer] article meta error:", err);
    return next(err);  // ← now next is in scope
  }
}

export async function renderCategoryMeta(req, res, next) {  // ← add next
  const { slug } = req.params;
  try {
    const rows = await sql`
      SELECT name, description FROM categories WHERE slug = ${slug} LIMIT 1
    `;

    const canonicalUrl = `${SITE_URL}/category/${slug}`;

    if (!rows.length) {
      return res.status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .send(buildMetaHtml({
          title: null, description: DEFAULT_DESCRIPTION,
          ogImage: DEFAULT_OG_IMAGE, ogType: "website",
          canonicalUrl: SITE_URL, article: null,
        }));
    }

    const row = rows[0];
    return res.status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=3600")
      .send(buildMetaHtml({
        title:       `${row.name} News`,
        description: row.description || `Latest ${row.name} news — ${SITE_NAME}`,
        ogImage:     DEFAULT_OG_IMAGE,
        ogType:      "website",
        canonicalUrl,
        article:     null,
      }));
  } catch (err) {
    console.error("[botRenderer] category meta error:", err);
    return next(err);
  }
}