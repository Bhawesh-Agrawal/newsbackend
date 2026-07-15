import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const FETCH_TIMEOUT = 10_000;

const IMAGE_BLACKLIST = /icon|logo|avatar|pixel|spacer|tracking|ad[-_]?banner|sprite/i;

// ── Helpers ──────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function resolveUrl(relative, base) {
  try {
    return new URL(relative, base).href;
  } catch {
    return null;
  }
}

function extractMeta($) {
  const ogTitle       = $('meta[property="og:title"]').attr('content') || null;
  const ogDescription = $('meta[property="og:description"]').attr('content') || null;
  const ogImage       = $('meta[property="og:image"]').attr('content') || null;
  const twitterImage  = $('meta[name="twitter:image"]').attr('content') || $('meta[property="twitter:image"]').attr('content') || null;
  const author        = $('meta[name="author"]').attr('content')
                     || $('meta[property="article:author"]').attr('content')
                     || null;
  const publishedAt   = $('meta[property="article:published_time"]').attr('content')
                     || $('meta[name="pubdate"]').attr('content')
                     || $('meta[name="date"]').attr('content')
                     || null;

  return { ogTitle, ogDescription, ogImage: ogImage || twitterImage, author, publishedAt };
}

function isArticleBodyValid(text, title) {
  return text && text.length > 250 && title;
}

// ── Image extraction ─────────────────────────────────────────────

async function validateImageUrl(url) {
  // If URL looks like a real image (common extensions), accept without HEAD check
  // Many news sites block HEAD requests or require auth headers
  if (/\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(url)) {
    return true;
  }

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.startsWith('image/')) return true;

    // HEAD failed or wrong content-type — try GET with range to confirm
    const res2 = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
      headers: { Range: 'bytes=0-0' },
    });
    const ct2 = res2.headers.get('content-type') || '';
    return res2.ok && ct2.startsWith('image/');
  } catch {
    // If all checks fail but URL has image-like path, still accept it
    return /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\/.*)?$/i.test(url);
  }
}

async function extractImages($, bodySelector, baseUrl) {
  const heroImage = $('meta[property="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')
    || null;

  const additionalImages = [];
  const searchScope = bodySelector ? $(bodySelector) : $('body');

  searchScope.find('img').each((_, el) => {
    const raw = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('srcset')?.split(',')[0]?.trim()?.split(/\s+/)[0];
    if (!raw) return;
    const abs = resolveUrl(raw, baseUrl);
    if (!abs) return;
    if (IMAGE_BLACKLIST.test(abs)) return;
    if (additionalImages.length >= 10) return;
    additionalImages.push(abs);
  });

  // Validate hero image
  let validHero = heroImage;
  if (heroImage) {
    const ok = await validateImageUrl(heroImage);
    if (!ok) validHero = null;
  }

  // Filter out hero from additional
  const filteredAdditional = validHero
    ? additionalImages.filter((u) => u !== validHero)
    : additionalImages;

  return { heroImageUrl: validHero, additionalImageUrls: filteredAdditional };
}

// ── Layer 1: Static fetch + Readability ──────────────────────────

async function layer1Readability(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: 'follow',
  });

  if (!res.ok) {
    return { success: false, failureReason: `http_${res.status}` };
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Remove noise before Readability
  $('script, style, nav, footer, header, aside, .ad, .ads, .sidebar, .social-share').remove();

  const meta = extractMeta($);
  const dom = new JSDOM($.html(), { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const title = article?.title || meta.ogTitle || $('title').text().trim() || null;
  const bodyText = article?.textContent?.trim() || '';
  const author = meta.author || article?.byline || null;

  if (!isArticleBodyValid(bodyText, title)) {
    return { success: false, failureReason: 'empty_content' };
  }

  return {
    success: true,
    title,
    author,
    publishedAt: meta.publishedAt,
    rawExtractedText: bodyText,
    meta,
    bodyHtml: article?.content || '',
  };
}

// ── Layer 2: Playwright browser render ───────────────────────────

async function layer2BrowserRender(url) {
  let browser;
  try {
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    const html = await page.content();

    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, .ad, .ads, .sidebar').remove();

    const meta = extractMeta($);
    const dom = new JSDOM($.html(), { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const title = article?.title || meta.ogTitle || $('title').text().trim() || null;
    const bodyText = article?.textContent?.trim() || '';
    const author = meta.author || article?.byline || null;

    if (!isArticleBodyValid(bodyText, title)) {
      return { success: false, failureReason: 'empty_content' };
    }

    return {
      success: true,
      title,
      author,
      publishedAt: meta.publishedAt,
      rawExtractedText: bodyText,
      meta,
      bodyHtml: article?.content || '',
    };
  } catch (err) {
    return { success: false, failureReason: `browser_error: ${err.message}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Layer 3: LLM extraction ─────────────────────────────────────

async function layer3LlmExtraction(url, html) {
  const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

  // Strip boilerplate to reduce token count
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, nav, footer, header, aside, form, .ad, .ads, .sidebar, .social-share, .comments, .related').remove();
  const cleaned = $.text().replace(/\s+/g, ' ').trim().slice(0, 12_000);

  if (cleaned.length < 100) {
    return { success: false, failureReason: 'insufficient_content_for_llm' };
  }

  const prompt = `Extract the main article title, author, publish date, and full body text from the following webpage content.

Return ONLY valid JSON matching this schema:
{
  "title": "string",
  "author": "string or null",
  "published_date": "ISO 8601 string or null",
  "body": "string — the full article text"
}

If no article content is found, return: {"error": "no_article_found"}

Webpage content:
${cleaned}`;

  const res = await fetch(NVIDIA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    return { success: false, failureReason: `llm_api_error: ${res.status}` };
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return { success: false, failureReason: 'llm_empty_response' };
  }

  try {
    // Try to extract JSON from the response (may be wrapped in markdown code block)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, failureReason: 'llm_malformed_json' };
    }
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.error || !parsed.body || parsed.body.length < 50) {
      return { success: false, failureReason: parsed.error || 'llm_no_article_found' };
    }

    return {
      success: true,
      title: parsed.title || null,
      author: parsed.author || null,
      publishedAt: parsed.published_date || null,
      rawExtractedText: parsed.body,
    };
  } catch {
    return { success: false, failureReason: 'llm_json_parse_error' };
  }
}

// ── Main pipeline ────────────────────────────────────────────────

export async function extractArticle(url) {
  const domain = extractDomain(url);
  const result = {
    title: null,
    author: null,
    publishedAt: null,
    rawExtractedText: null,
    heroImageUrl: null,
    additionalImageUrls: null,
    extractionMethodUsed: null,
    extractionStatus: 'failed',
    failureReason: null,
  };

  // Layer 1: Static fetch + Readability
  let layer1;
  try {
    layer1 = await layer1Readability(url);
  } catch (err) {
    layer1 = { success: false, failureReason: `fetch_error: ${err.message}` };
  }

  if (layer1.success) {
    result.title = layer1.title;
    result.author = layer1.author;
    result.publishedAt = layer1.publishedAt;
    result.rawExtractedText = layer1.rawExtractedText;
    result.extractionMethodUsed = 'readability';
    result.extractionStatus = 'success';

    // Extract images — use meta.ogImage as hero fallback
    try {
      const $ = cheerio.load(layer1.bodyHtml || '');
      const imgs = await extractImages($, null, url);
      result.heroImageUrl = imgs.heroImageUrl || layer1.meta?.ogImage || null;
      result.additionalImageUrls = imgs.additionalImageUrls.length > 0 ? imgs.additionalImageUrls : null;
    } catch {
      // Even if body image scan fails, use og:image if available
      result.heroImageUrl = layer1.meta?.ogImage || null;
    }
    return result;
  }

  // Layer 2: Playwright browser render
  let layer2;
  try {
    layer2 = await layer2BrowserRender(url);
  } catch (err) {
    layer2 = { success: false, failureReason: `browser_error: ${err.message}` };
  }

  if (layer2.success) {
    result.title = layer2.title;
    result.author = layer2.author;
    result.publishedAt = layer2.publishedAt;
    result.rawExtractedText = layer2.rawExtractedText;
    result.extractionMethodUsed = 'browser_render';
    result.extractionStatus = 'success';

    try {
      const $ = cheerio.load(layer2.bodyHtml || '');
      const imgs = await extractImages($, null, url);
      result.heroImageUrl = imgs.heroImageUrl || layer2.meta?.ogImage || null;
      result.additionalImageUrls = imgs.additionalImageUrls.length > 0 ? imgs.additionalImageUrls : null;
    } catch {
      result.heroImageUrl = layer2.meta?.ogImage || null;
    }
    return result;
  }

  // Layer 3: LLM extraction (need raw HTML)
  let rawHtml;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (res.ok) rawHtml = await res.text();
  } catch {}

  if (!rawHtml) {
    result.failureReason = layer2.failureReason || layer1.failureReason || 'fetch_failed';
    return result;
  }

  let layer3;
  try {
    layer3 = await layer3LlmExtraction(url, rawHtml);
  } catch (err) {
    layer3 = { success: false, failureReason: `llm_error: ${err.message}` };
  }

  if (layer3.success) {
    result.title = layer3.title;
    result.author = layer3.author;
    result.publishedAt = layer3.publishedAt;
    result.rawExtractedText = layer3.rawExtractedText;
    result.extractionMethodUsed = 'llm_fallback';
    result.extractionStatus = 'success';

    // LLM layer has no og:image meta — scan full HTML for images
    try {
      const $ = cheerio.load(rawHtml);
      const imgs = await extractImages($, null, url);
      result.heroImageUrl = imgs.heroImageUrl || null;
      result.additionalImageUrls = imgs.additionalImageUrls.length > 0 ? imgs.additionalImageUrls : null;
    } catch {}
    return result;
  }

  // All layers failed
  result.failureReason = layer3.failureReason || layer2.failureReason || layer1.failureReason || 'all_layers_failed';
  return result;
}
