import sql from "../config/database.js";
import 'dotenv/config';

const SITE_URL    = process.env.FRONTEND_URL || 'https://www.mangopeoplenews.com';
const SITE_NAME   = "Mango People News";
const DEFAULT_DESCRIPTION =
  "India's financial and business news platform. Markets, economy, policy and more. News for Every Indian.";
const DEFAULT_OG_IMAGE = `${SITE_URL}/logo.png`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeAttr(str = "") {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/"/g,  "&quot;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;");
}

function escapeJson(str = "") {
  return String(str)
    .replace(/</g,  "\\u003c")
    .replace(/>/g,  "\\u003e")
    .replace(/&/g,  "\\u0026");
}

function toIso(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── JSON-LD builder ──────────────────────────────────────────────────────────

function buildJsonLd({ title, description, ogImage, canonicalUrl, article }) {
  if (!article) return "";

  const schema = {
    "@context":        "https://schema.org",
    "@type":           "NewsArticle",
    "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl },
    "headline":        title || SITE_NAME,
    "description":     description || DEFAULT_DESCRIPTION,
    "image":           ogImage || DEFAULT_OG_IMAGE,
    "datePublished":   toIso(article.publishedTime),
    "dateModified":    toIso(article.modifiedTime) || toIso(article.publishedTime),
    "author":          { "@type": "Person", "name": article.authorName || SITE_NAME },
    "publisher": {
      "@type": "NewsMediaOrganization",
      "name":  SITE_NAME,
      "logo":  { "@type": "ImageObject", "url": `${SITE_URL}/logo.png` },
    },
    "inLanguage":       "en-IN",
    "isAccessibleForFree": true,
  };

  if (article.section) schema.articleSection = article.section;

  return `<script type="application/ld+json">${escapeJson(JSON.stringify(schema))}<\/script>`;
}

// ─── HTML builder ─────────────────────────────────────────────────────────────
// Produces a complete, self-contained HTML document with all meta tags.
// Body is intentionally empty — this is only served to bots, not real users.

function buildMetaHtml({
  title,
  description   = DEFAULT_DESCRIPTION,
  ogImage       = DEFAULT_OG_IMAGE,
  ogType        = "website",
  canonicalUrl,
  article       = null,
  noIndex       = false,
}) {
  const fullTitle = title
    ? `${title} — ${SITE_NAME}`
    : `${SITE_NAME} — News for Every Indian`;

  const resolvedImage = ogImage?.startsWith("http")
    ? ogImage
    : `${SITE_URL}${ogImage}`;

  // Robots tag: always index/follow UNLESS explicitly set to noIndex
  const robotsContent = noIndex ? "noindex, nofollow" : "index, follow";

  const articleMeta =
    ogType === "article" && article
      ? `
  <meta property="article:published_time" content="${escapeAttr(toIso(article.publishedTime) || "")}" />
  <meta property="article:modified_time"  content="${escapeAttr(toIso(article.modifiedTime) || toIso(article.publishedTime) || "")}" />
  <meta property="article:author"         content="${escapeAttr(article.authorName || SITE_NAME)}" />
  <meta property="article:section"        content="${escapeAttr(article.section    || "")}" />`
      : "";

  const jsonLd = buildJsonLd({
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeAttr(fullTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <meta name="robots"      content="${robotsContent}" />
  <link rel="canonical"    href="${escapeAttr(canonicalUrl)}" />

  <meta property="og:type"         content="${ogType}" />
  <meta property="og:site_name"    content="${SITE_NAME}" />
  <meta property="og:title"        content="${escapeAttr(fullTitle)}" />
  <meta property="og:description"  content="${escapeAttr(description)}" />
  <meta property="og:url"          content="${escapeAttr(canonicalUrl)}" />
  <meta property="og:image"        content="${escapeAttr(resolvedImage)}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt"    content="${escapeAttr(fullTitle)}" />
  <meta property="og:locale"       content="en_IN" />
  ${articleMeta}

  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:site"        content="@mangopeoplenews" />
  <meta name="twitter:title"       content="${escapeAttr(fullTitle)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image"       content="${escapeAttr(resolvedImage)}" />

  ${jsonLd}
</head>
<body></body>
</html>`;
}

// ─── /meta/article/:slug ─────────────────────────────────────────────────────

export async function renderArticleMeta(req, res, next) {
  const { slug } = req.params;

  // Guard: slug must look like a real slug
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).send("Bad request");
  }

  const canonicalUrl = `${SITE_URL}/article/${slug}`;

  try {
    const rows = await sql`
      SELECT
        a.title,
        a.excerpt,
        a.cover_image,
        a.published_at,
        a.updated_at,
        u.full_name  AS author_name,
        c.name       AS category_name
      FROM articles a
      LEFT JOIN users      u ON u.id = a.author_id
      LEFT JOIN categories c ON c.id = a.category_id
      WHERE a.slug   = ${slug}
        AND a.status = 'published'
      LIMIT 1
    `;

    // ── Article not found ─────────────────────────────────────────────────────
    // Return 404 with the CORRECT canonical (the article URL, not the homepage).
    // Also set noIndex so Google doesn't index a ghost page.
    // Do NOT point canonical at the homepage — that's what caused the
    // "redirect error" in Search Console.
    if (!rows.length) {
      return res
        .status(404)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "public, max-age=60, stale-while-revalidate=30")
        .send(
          buildMetaHtml({
            title:       "Article Not Found",
            description: DEFAULT_DESCRIPTION,
            ogImage:     DEFAULT_OG_IMAGE,
            ogType:      "website",
            canonicalUrl,          // <-- keep the article URL, never the homepage
            article:     null,
            noIndex:     true,     // <-- tell Google not to index this
          })
        );
    }

    // ── Article found ─────────────────────────────────────────────────────────
    const row = rows[0];
    return res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      // Cache for 10 min, allow stale for 1 min while revalidating
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
          noIndex: false,
        })
      );

  } catch (err) {
    console.error("[botRenderer] article meta error:", err);
    // On DB error, return a safe fallback — still with the correct canonical
    return res
      .status(500)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "no-store")
      .send(
        buildMetaHtml({
          title:       null,
          description: DEFAULT_DESCRIPTION,
          ogImage:     DEFAULT_OG_IMAGE,
          ogType:      "website",
          canonicalUrl,
          article:     null,
          noIndex:     true,
        })
      );
  }
}

// ─── /meta/category/:slug ────────────────────────────────────────────────────

export async function renderCategoryMeta(req, res, next) {
  const { slug } = req.params;

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).send("Bad request");
  }

  const canonicalUrl = `${SITE_URL}/category/${slug}`;

  try {
    const rows = await sql`
      SELECT name, description
      FROM categories
      WHERE slug      = ${slug}
        AND is_active = TRUE
      LIMIT 1
    `;

    // ── Category not found ────────────────────────────────────────────────────
    if (!rows.length) {
      return res
        .status(404)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "public, max-age=60")
        .send(
          buildMetaHtml({
            title:       "Category Not Found",
            description: DEFAULT_DESCRIPTION,
            ogImage:     DEFAULT_OG_IMAGE,
            ogType:      "website",
            canonicalUrl,          // correct canonical, not the homepage
            article:     null,
            noIndex:     true,
          })
        );
    }

    // ── Category found ────────────────────────────────────────────────────────
    const row = rows[0];
    return res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=3600, stale-while-revalidate=300")
      .send(
        buildMetaHtml({
          title:       `${row.name} News`,
          description: row.description || `Latest ${row.name} news — ${SITE_NAME}`,
          ogImage:     DEFAULT_OG_IMAGE,
          ogType:      "website",
          canonicalUrl,
          article:     null,
          noIndex:     false,
        })
      );

  } catch (err) {
    console.error("[botRenderer] category meta error:", err);
    return res
      .status(500)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "no-store")
      .send(
        buildMetaHtml({
          title:       null,
          description: DEFAULT_DESCRIPTION,
          ogImage:     DEFAULT_OG_IMAGE,
          ogType:      "website",
          canonicalUrl,
          article:     null,
          noIndex:     true,
        })
      );
  }
}