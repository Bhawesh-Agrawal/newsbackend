// src/middleware/botRenderer.middleware.js
import sql from "../config/database.js";
import 'dotenv/config';

const SITE_URL = process.env.FRONTEND_URL;
const SITE_NAME = "Mango People News";
const DEFAULT_DESCRIPTION =
  "India's financial and business news platform. Markets, economy, policy and more. News for Every Indian.";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

// ─── Escape helpers ───────────────────────────────────────────────────────────

function escapeAttr(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Safe for embedding JSON inside a <script> tag
function escapeJson(str = "") {
  return String(str)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

// Convert any DB timestamp / date string to ISO 8601
function toIso(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── NewsArticle JSON-LD builder ──────────────────────────────────────────────

function buildNewsArticleJsonLd({ title, description, ogImage, canonicalUrl, article }) {
  if (!article) return "";

  const schema = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    "headline": title || SITE_NAME,
    "description": description || DEFAULT_DESCRIPTION,
    "image": ogImage || DEFAULT_OG_IMAGE,
    "datePublished": toIso(article.publishedTime),
    "dateModified": toIso(article.modifiedTime) || toIso(article.publishedTime),
    "author": {
      "@type": "Person",
      "name": article.authorName || SITE_NAME,
    },
    "publisher": {
      "@type": "NewsMediaOrganization",
      "name": SITE_NAME,
      "logo": {
        "@type": "ImageObject",
        "url": `${SITE_URL}/logo.png`,
      },
    },
    "inLanguage": "en-IN",
    "isAccessibleForFree": true,
  };

  // Only add articleSection if we have a value
  if (article.section) schema.articleSection = article.section;

  return `<script type="application/ld+json">${escapeJson(JSON.stringify(schema))}<\/script>`;
}

// ─── Main HTML builder ────────────────────────────────────────────────────────

function buildMetaHtml({ title, description, ogImage, ogType, canonicalUrl, article }) {
  const fullTitle = title
    ? `${title} — ${SITE_NAME}`
    : `${SITE_NAME} — News for Every Indian`;

  const resolvedImage = ogImage?.startsWith("http")
    ? ogImage
    : ogImage
    ? `${SITE_URL}${ogImage}`
    : DEFAULT_OG_IMAGE;

  const articleMeta =
    ogType === "article" && article
      ? `
    <meta property="article:published_time" content="${escapeAttr(toIso(article.publishedTime) || "")}" />
    <meta property="article:modified_time"  content="${escapeAttr(toIso(article.modifiedTime)  || toIso(article.publishedTime) || "")}" />
    <meta property="article:author"         content="${escapeAttr(article.authorName    || SITE_NAME)}" />
    <meta property="article:section"        content="${escapeAttr(article.section       || "")}" />`
      : "";

  const jsonLd = buildNewsArticleJsonLd({
    title,
    description,
    ogImage: resolvedImage,
    canonicalUrl,
    article,
  });

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

  ${jsonLd}

  <meta http-equiv="refresh" content="0;url=${canonicalUrl}" />
  <script>window.location.replace(${JSON.stringify(canonicalUrl)});</script>
</head>
<body></body>
</html>`;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

// Called for /meta/article/:slug bot hits
export async function renderArticleMeta(req, res, next) {
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
      return res
        .status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "public, max-age=60")
        .send(
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
    return res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=600, stale-while-revalidate=60")
      .send(
        buildMetaHtml({
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
        })
      );
  } catch (err) {
    console.error("[botRenderer] article meta error:", err);
    return next(err);
  }
}

// Called for /meta/category/:slug bot hits
export async function renderCategoryMeta(req, res, next) {
  const { slug } = req.params;
  try {
    const rows = await sql`
      SELECT name, description FROM categories WHERE slug = ${slug} LIMIT 1
    `;

    const canonicalUrl = `${SITE_URL}/category/${slug}`;

    if (!rows.length) {
      return res
        .status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .send(
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
    return res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=3600")
      .send(
        buildMetaHtml({
          title:       `${row.name} News`,
          description: row.description || `Latest ${row.name} news — ${SITE_NAME}`,
          ogImage:     DEFAULT_OG_IMAGE,
          ogType:      "website",
          canonicalUrl,
          article:     null,
        })
      );
  } catch (err) {
    console.error("[botRenderer] category meta error:", err);
    return next(err);
  }
}