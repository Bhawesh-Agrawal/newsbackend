import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

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

function isRateLimitedPage(html) {
  if (!html || html.length > 5000) return false;
  const sigs = [
    'Please enable JS and disable any ad blocker',
    'data-cfasync="false"',
    'captcha-delivery.com',
    '"rt":"c"',
    '#cmsg{animation',
    'Checking your browser',
    'cf-browser-verification',
    'DDoS protection',
    'challenge-platform',
  ];
  return sigs.some(s => html.includes(s));
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
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Referer': 'https://www.google.com/',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'DNT': '1',
      'Upgrade-Insecure-Requests': '1',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: 'follow',
  });

  if (!res.ok) {
    console.log(`[layer1Readability] Fetch failed with status: ${res.status} for URL: ${url}`);
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
    console.log(`[layer1Readability] Invalid article body. Title length: ${title?.length || 0}, Body length: ${bodyText?.length || 0}`);
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

function buildBrowserContextConfig(userAgent, viewport) {
  return {
    userAgent,
    viewport,
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    forcedColors: 'none',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  };
}

function extractAuthorName(author) {
  if (!author) return null;
  if (typeof author === 'string') return author;
  if (author.name) return author.name;
  if (Array.isArray(author) && author.length > 0) return author[0].name || null;
  return null;
}

function extractArticleFromJsonLd($) {
  let body = null, title = null, author = null, date = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).html());
      const items = [];
      if (Array.isArray(raw)) items.push(...raw);
      else if (raw['@graph']) items.push(...raw['@graph']);
      else items.push(raw);

      for (const item of items) {
        const type = item['@type'] || '';
        if (!type.includes('Article') && !type.includes('News')) continue;
        if (item.articleBody && item.articleBody.length > 250) {
          body = body || item.articleBody;
          title = title || item.headline || null;
          author = author || extractAuthorName(item.author);
          date = date || item.datePublished || null;
        }
      }
    } catch {}
  });

  return { body, title, author, date };
}

function extractArticleFromNextData($) {
  const el = $('#__NEXT_DATA__');
  if (!el.length) return null;
  try {
    const parsed = JSON.parse(el.html());
    const paths = [
      ['props', 'pageProps', 'article', 'body'],
      ['props', 'pageProps', 'article', 'content'],
      ['props', 'pageProps', 'post', 'body'],
      ['props', 'pageProps', 'data', 'body'],
      ['props', 'pageProps', 'story', 'body'],
    ];
    for (const path of paths) {
      let val = parsed;
      for (const key of path) {
        if (val && typeof val === 'object') val = val[key];
        else { val = undefined; break; }
      }
      if (typeof val === 'string' && val.length > 250) return val;
    }
  } catch {}
  return null;
}

function extractArticleFromFusionGlobalContent($) {
  let rawData = null;
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    const marker = 'Fusion.globalContent=';
    const idx = text.indexOf(marker);
    if (idx === -1) return;

    const jsonStart = idx + marker.length;
    let braceCount = 0, pos = jsonStart;
    for (; pos < text.length; pos++) {
      if (text[pos] === '{') braceCount++;
      else if (text[pos] === '}') {
        braceCount--;
        if (braceCount === 0) break;
      }
    }
    if (braceCount !== 0) return;
    try { rawData = JSON.parse(text.slice(jsonStart, pos + 1)); } catch { return; }
    return false;
  });

  if (!rawData) return null;

  const result = rawData.result || rawData;
  const title = result.headlines?.basic || result.web || result.headline || result.title || null;

  let author = null;
  if (result.credits?.by?.[0]) {
    author = result.credits.by[0].name || result.credits.by[0] || null;
  }
  const date = result.display_date || result.publish_date || result.date || null;

  let body = '';
  if (result.content_elements) {
    body = result.content_elements
      .filter(e => e.type === 'text')
      .map(e => e.content || '')
      .join('\n\n');
  }
  if (!body || body.length < 250) {
    body = body || result.body || result.content || result.articleBody || '';
  }
  if (body) body = body.replace(/<[^>]+>/g, '').trim();
  if (!body || body.length < 250) return null;

  return { body, title, author, date };
}

async function tryExtractPage(page, pageUrl) {
  const html = await page.content();
  const $ = cheerio.load(html);

  // Debug: report page state for Reuters
  if (pageUrl.includes('reuters.com')) {
    const hasNd = $('#__NEXT_DATA__').length > 0;
    const ldCount = $('script[type="application/ld+json"]').length;
    console.log(`[tryExtractPage] Page: ${html.length} bytes, title: "${$('title').text().trim().slice(0, 60)}", __NEXT_DATA__: ${hasNd}, JSON-LD: ${ldCount}`);
  }

  // Extract article body from embedded JSON data before stripping scripts
  const jsonLd = extractArticleFromJsonLd($);
  const nextBody = jsonLd.body ? null : extractArticleFromNextData($);
  let jsonBody = jsonLd.body || nextBody;

  // Fallback 3: Fusion globalContent (Arc Publishing — Reuters, WashPost, etc.)
  if (!jsonBody) {
    const fusion = extractArticleFromFusionGlobalContent($);
    if (fusion) {
      jsonBody = fusion.body;
      jsonLd.title = jsonLd.title || fusion.title;
      jsonLd.author = jsonLd.author || fusion.author;
      jsonLd.date = jsonLd.date || fusion.date;
      console.log(`[tryExtractPage] Extracted body from Fusion.globalContent (${jsonBody.length} chars)`);
    }
  }

  // If found in JSON, inject as visible HTML so Readability can parse it
  if (jsonBody) {
    const cleanText = jsonBody.replace(/<[^>]+>/g, '').trim();
    const paragraphs = cleanText
      .split(/\n{2,}/)
      .map(p => `<p>${p.trim()}</p>`)
      .join('');
    $('body').append(`<div id="extracted-article-body">${paragraphs}</div>`);
  }

  $('script, style, nav, footer, header, aside, .ad, .ads, .sidebar').remove();

  const meta = extractMeta($);
  const dom = new JSDOM($.html(), { url: pageUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const title = article?.title || jsonLd.title || meta.ogTitle || $('title').text().trim() || null;
  const bodyText = article?.textContent?.trim() || jsonBody || '';
  const author = jsonLd.author || meta.author || article?.byline || null;
  const publishedAt = jsonLd.date || meta.publishedAt || null;

  if (!isArticleBodyValid(bodyText, title)) {
    return { success: false, html };
  }

  return {
    success: true,
    title,
    author,
    publishedAt,
    rawExtractedText: bodyText,
    meta: { ...meta, ogTitle: meta.ogTitle || title },
    bodyHtml: article?.content || '',
    html,
  };
}

async function dismissPageBlockers(page) {
  await page.evaluate(() => {
    const blockers = document.querySelectorAll(
      '[class*="consent"], [class*="overlay"], [class*="paywall"], ' +
      '[class*="modal"], [class*="popup"], [id*="sp_message"], ' +
      '[class*="gdpr"], [class*="cookie"], [class*="wall"], ' +
      '[class*="notice"], [class*="banner"], [aria-label*="cookie"], ' +
      '[class*="privacy"], [class*="fc-consent"]'
    );
    blockers.forEach(el => el.remove());
    document.body.style.overflow = 'auto';
  });
}

async function layer2BrowserRender(url) {
  let browser;
  try {
    const { chromium } = await import('playwright-extra');
    const stealthModule = await import('puppeteer-extra-plugin-stealth');
    const stealth = stealthModule.default ? stealthModule.default() : stealthModule();
    chromium.use(stealth);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
      ],
    });

    let lastHtml = null;

    // ── Strategy 1: Desktop context (DataDome-aware) ──────────
    const context = await browser.newContext(
      buildBrowserContextConfig(USER_AGENT, { width: 1920, height: 1080 }),
    );
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await dismissPageBlockers(page);
    // Wait for DataDome challenge script to load and execute
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    // Give DataDome time to solve the JS challenge and redirect
    await page.waitForTimeout(8000);
    // Check if DataDome redirected after solving the challenge
    let currentUrl = page.url();
    if (currentUrl !== url) {
      console.log(`[layer2BrowserRender] DataDome redirected to: ${currentUrl}`);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
    await page.waitForSelector(
      'article, [class*="article"], [class*="content"], main, [class*="body"]',
      { timeout: 10_000 },
    ).catch(() => {});
    await page.waitForTimeout(3000);
    // Wait for actual article content to render in the DOM
    try {
      await page.waitForFunction(
        () => {
          const a = document.querySelector('article');
          return a && a.textContent.length > 500;
        },
        { timeout: 20_000, polling: 1000 },
      );
      console.log(`[layer2BrowserRender] Article content detected in DOM`);
    } catch {
      console.log(`[layer2BrowserRender] Article content wait timed out, proceeding anyway`);
    }

    let result = await tryExtractPage(page, currentUrl);

    // ── Strategy 2: AMP URL (if desktop failed) ────────────────
    if (!result.success) {
      console.log(`[layer2BrowserRender] Desktop failed, trying AMP URL...`);
      const ampUrl = url.includes('?') ? `${url}&amp=1` : `${url}?amp=1`;
      try {
        await page.goto(ampUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await dismissPageBlockers(page);
        await page.waitForTimeout(4000);
        result = await tryExtractPage(page, ampUrl);
      } catch (err) {
        console.log(`[layer2BrowserRender] AMP URL error: ${err.message}`);
      }
    }

    // ── Strategy 3: Mobile context (if AMP failed) ─────────────
    if (!result.success) {
      console.log(`[layer2BrowserRender] AMP failed, trying mobile context...`);
      // Brief delay to reduce rate-limit accumulation from prior requests
      await new Promise(r => setTimeout(r, 5000));
      try {
        const mobileContext = await browser.newContext(
          buildBrowserContextConfig(MOBILE_USER_AGENT, { width: 390, height: 844 }),
        );
        const mobilePage = await mobileContext.newPage();
        await mobilePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await dismissPageBlockers(mobilePage);
        await mobilePage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await mobilePage.waitForTimeout(8000);
        let mobileUrl = mobilePage.url();
        if (mobileUrl !== url) {
          await mobilePage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
          await mobilePage.waitForTimeout(3000);
        }
        // Wait for actual article content to render in the DOM
        try {
          await mobilePage.waitForFunction(
            () => {
              const a = document.querySelector('article');
              return a && a.textContent.length > 500;
            },
            { timeout: 30_000, polling: 1000 },
          );
          console.log(`[layer2BrowserRender] Article content detected in DOM`);
        } catch {
          console.log(`[layer2BrowserRender] Article content wait timed out, proceeding anyway`);
        }
        result = await tryExtractPage(mobilePage, mobileUrl);
        await mobileContext.close();
      } catch (err) {
        console.log(`[layer2BrowserRender] Mobile context error: ${err.message}`);
      }
    }

    await context.close();

    // ── Strategy 4: Firefox (if all Chrome strategies failed) ──
    if (!result.success) {
      console.log(`[layer2BrowserRender] Chrome strategies failed, trying Firefox...`);
      try {
        const stealthModule2 = await import('puppeteer-extra-plugin-stealth');
        const stealth2 = stealthModule2.default ? stealthModule2.default() : stealthModule2();
        const { firefox } = await import('playwright-extra');
        firefox.use(stealth2);

        const ffBrowser = await firefox.launch({
          headless: true,
          args: ['--no-sandbox'],
        });
        const ffContext = await ffBrowser.newContext(
          buildBrowserContextConfig(
            USER_AGENT.replace('Edg/', 'Firefox/').replace('Chrome/128', 'Firefox/128'),
            { width: 1920, height: 1080 },
          ),
        );
        const ffPage = await ffContext.newPage();
        await ffPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await dismissPageBlockers(ffPage);
        await ffPage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await ffPage.waitForTimeout(10000);
        let ffUrl = ffPage.url();
        if (ffUrl !== url) {
          await ffPage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
          await ffPage.waitForTimeout(3000);
        }
        result = await tryExtractPage(ffPage, ffUrl);
        await ffContext.close();
        await ffBrowser.close().catch(() => {});
      } catch (err) {
        console.log(`[layer2BrowserRender] Firefox error: ${err.message}`);
      }
    }

    lastHtml = result.html || null;

    if (!result.success) {
      console.log(`[layer2BrowserRender] All strategies failed. Body: ${result.html?.length || 0} bytes`);
      if (result.html) {
        const titleMatch = result.html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const ogTitleMatch = result.html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
        console.log(`[layer2BrowserRender] ═══ PAGE HTML DEBUG (${result.html.length} bytes) ═══`);
        console.log(`[layer2BrowserRender] <title>: ${titleMatch ? titleMatch[1].trim() : '(none)'}`);
        console.log(`[layer2BrowserRender] og:title: ${ogTitleMatch ? ogTitleMatch[1] : '(none)'}`);
        console.log(`[layer2BrowserRender] First 1500 chars:\n${result.html.slice(0, 1500)}`);
        console.log(`[layer2BrowserRender] ═══ END DEBUG ═══`);
      }
      const rateLimited = lastHtml ? isRateLimitedPage(lastHtml) : false;
      return {
        success: false,
        failureReason: rateLimited ? 'target_rate_limited' : 'empty_content',
        rawHtml: lastHtml,
      };
    }

    console.log(`[layer2BrowserRender] Extracted: "${result.title}" (${result.rawExtractedText.length} chars)`);
    return {
      success: true,
      title: result.title,
      author: result.author,
      publishedAt: result.publishedAt,
      rawExtractedText: result.rawExtractedText,
      meta: result.meta,
      bodyHtml: result.bodyHtml,
    };
  } catch (err) {
    console.error(`[layer2BrowserRender] Browser error: ${err.message}`);
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
      model: 'meta/llama-3.2-11b-vision-instruct',
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

// ── Layer 4: Google Web Cache ─────────────────────────────────────

async function layer4GoogleCache(url) {
  // strip=1 removes Google's cache header bar; vwsrc=0 removes visual view source link
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}&strip=1&vwsrc=0`;

  try {
    const res = await fetch(cacheUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Referer': 'https://www.google.com/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    });

    if (!res.ok) {
      console.log(`[layer4GoogleCache] Fetch failed with status: ${res.status} for URL: ${url}`);
      return { success: false, failureReason: `cache_http_${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove any remaining Google cache wrapper elements
    $('style, script, noscript').remove();

    const meta = extractMeta($);
    const dom = new JSDOM($.html(), { url: cacheUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const title = article?.title || meta.ogTitle || $('title').text().trim() || null;
    const bodyText = article?.textContent?.trim() || '';
    const author = meta.author || article?.byline || null;

    if (!isArticleBodyValid(bodyText, title)) {
      console.log(`[layer4GoogleCache] Invalid article body. Title length: ${title?.length || 0}, Body length: ${bodyText?.length || 0}`);
      return { success: false, failureReason: 'empty_content' };
    }

    console.log(`[layer4GoogleCache] Extracted article: "${title}" (${bodyText.length} chars)`);
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
    console.error(`[layer4GoogleCache] Error: ${err.message}`);
    return { success: false, failureReason: `cache_error: ${err.message}` };
  }
}

// ── Layer 5: Jina AI Reader ───────────────────────────────────────

async function layer5JinaReader(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;

  try {
    const res = await fetch(jinaUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/plain, text/markdown, text/html',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });

    if (!res.ok) {
      console.log(`[layer5JinaReader] Fetch failed with status: ${res.status}`);
      return { success: false, failureReason: `jina_http_${res.status}` };
    }

    const text = await res.text();

    if (!text || text.length < 100) {
      return { success: false, failureReason: 'empty_content' };
    }

    // Jina returns markdown. First line starting with # is usually the title
    const lines = text.trim().split('\n');
    let title = null;
    let bodyStart = 0;

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const match = lines[i].match(/^#\s+(.+)/);
      if (match) {
        title = match[1].trim();
        bodyStart = i + 1;
        break;
      }
    }

    const body = lines.slice(bodyStart).join('\n').trim();
    const plainBody = body.replace(/[#*_\[\]`>|~-]/g, '').replace(/\s+/g, ' ').trim();

    if (!isArticleBodyValid(plainBody, title)) {
      return { success: false, failureReason: 'empty_content' };
    }

    console.log(`[layer5JinaReader] Extracted article: "${title}" (${plainBody.length} chars)`);
    return {
      success: true,
      title,
      author: null,
      publishedAt: null,
      rawExtractedText: plainBody,
      meta: { ogTitle: title },
      bodyHtml: body,
    };
  } catch (err) {
    console.error(`[layer5JinaReader] Error: ${err.message}`);
    return { success: false, failureReason: `jina_error: ${err.message}` };
  }
}

// ── Layer 6: 12ft.io proxy ────────────────────────────────────────

async function layer6TwelveFoot(url) {
  const proxyUrl = `https://12ft.io/proxy?q=${encodeURIComponent(url)}`;

  try {
    const res = await fetch(proxyUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });

    if (!res.ok) {
      console.log(`[layer6TwelveFoot] Fetch failed with status: ${res.status}`);
      return { success: false, failureReason: `12ft_http_${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, .ad, .ads, .sidebar').remove();

    const meta = extractMeta($);
    const dom = new JSDOM($.html(), { url: proxyUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const title = article?.title || meta.ogTitle || $('title').text().trim() || null;
    const bodyText = article?.textContent?.trim() || '';
    const author = meta.author || article?.byline || null;

    if (!isArticleBodyValid(bodyText, title)) {
      console.log(`[layer6TwelveFoot] Invalid article body. Title length: ${title?.length || 0}, Body length: ${bodyText?.length || 0}`);
      return { success: false, failureReason: 'empty_content' };
    }

    console.log(`[layer6TwelveFoot] Extracted article: "${title}" (${bodyText.length} chars)`);
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
    console.error(`[layer6TwelveFoot] Error: ${err.message}`);
    return { success: false, failureReason: `12ft_error: ${err.message}` };
  }
}

// ── Layer 7: Archive.ph ────────────────────────────────────────────

async function layer7ArchivePh(url) {
  const archiveUrl = `https://archive.is/newest/${encodeURIComponent(url)}`;

  try {
    const res = await fetch(archiveUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });

    if (!res.ok) {
      console.log(`[layer7ArchivePh] Fetch failed with status: ${res.status}`);
      return { success: false, failureReason: `archive_http_${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Archive.ph wraps the page in its own UI. Try to find the actual page content.
    // Usually the archived page is inside <blockquote> or <div id="page"> or similar.
    const contentSelectors = [
      'blockquote', '#page', '#CONTENT', 'article', '[role="main"]',
      '.archive-body', '.snapshot-content',
    ];
    for (const sel of contentSelectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 500) {
        return await extractFromHtml($.html(), el.toString(), archiveUrl, sel);
      }
    }

    // Fallback: run Readability on the full page
    return await extractFromHtml(html, html, archiveUrl);
  } catch (err) {
    console.error(`[layer7ArchivePh] Error: ${err.message}`);
    return { success: false, failureReason: `archive_error: ${err.message}` };
  }
}

async function extractFromHtml(fullHtml, scopeHtml, baseUrl, selector) {
  const $ = cheerio.load(fullHtml);
  const scope = selector ? $(fullHtml).find(selector) : $(fullHtml);
  const cleanHtml = scope ? $(scope).html() || scopeHtml : scopeHtml;
  const $2 = cheerio.load(cleanHtml || scopeHtml);
  $2('script, style, nav, footer, header, aside, .ad, .ads, .sidebar').remove();

  const meta = extractMeta($);
  const dom = new JSDOM($2.html(), { url: baseUrl });
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

// ── Layer 8: Apify Reuters Scraper (last resort, reuters.com only) ─

async function layer8ApifyReuters(url) {
  const domain = extractDomain(url);
  if (domain !== 'reuters.com') {
    return { success: false, failureReason: 'domain_not_supported' };
  }

  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    return { success: false, failureReason: 'no_api_key' };
  }

  try {
    const res = await fetch(
      'https://api.apify.com/v2/acts/xtracto~reuters-scraper/run-sync-get-dataset-items',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, mode: 'article' }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      console.log(`[layer8ApifyReuters] API failed with status: ${res.status}`);
      return { success: false, failureReason: `apify_http_${res.status}` };
    }

    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : data?.data?.[0] || data;

    if (!item) {
      return { success: false, failureReason: 'apify_empty_response' };
    }

    const title = item.headline || item.title || null;
    const bodyText = item.text || item.body || item.content || '';
    const author = item.author || null;
    const publishedAt = item.datePublished || item.publishedDate || null;

    if (!isArticleBodyValid(bodyText, title)) {
      return { success: false, failureReason: 'empty_content' };
    }

    console.log(`[layer8ApifyReuters] Extracted: "${title}" (${bodyText.length} chars)`);
    return {
      success: true,
      title,
      author,
      publishedAt,
      rawExtractedText: bodyText,
      meta: { ogTitle: title },
      bodyHtml: bodyText.replace(/\n/g, '<br>'),
    };
  } catch (err) {
    console.error(`[layer8ApifyReuters] Error: ${err.message}`);
    return { success: false, failureReason: `apify_error: ${err.message}` };
  }
}

// ── Main pipeline ────────────────────────────────────────────────

export async function extractArticle(url) {
  console.log(`\n[extractArticle] === Starting extraction for URL: ${url} ===`);
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
    console.log(`[extractArticle] Attempting Layer 1 (Readability)`);
    layer1 = await layer1Readability(url);
  } catch (err) {
    console.error(`[extractArticle] Layer 1 threw error: ${err.message}`);
    layer1 = { success: false, failureReason: `fetch_error: ${err.message}` };
  }

  if (layer1.success) {
    console.log(`[extractArticle] Layer 1 succeeded.`);
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

  console.log(`[extractArticle] Layer 1 failed: ${layer1.failureReason}`);

  // Layer 2: Playwright browser render
  let layer2;
  try {
    console.log(`[extractArticle] Attempting Layer 2 (Playwright browser render)`);
    layer2 = await layer2BrowserRender(url);
  } catch (err) {
    console.error(`[extractArticle] Layer 2 threw error: ${err.message}`);
    layer2 = { success: false, failureReason: `browser_error: ${err.message}` };
  }

  if (layer2.success) {
    console.log(`[extractArticle] Layer 2 succeeded.`);
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

  console.log(`[extractArticle] Layer 2 failed: ${layer2.failureReason}`);

  // Layer 4: Google Web Cache
  let layer4;
  try {
    console.log(`[extractArticle] Attempting Layer 4 (Google Web Cache)`);
    layer4 = await layer4GoogleCache(url);
  } catch (err) {
    console.error(`[extractArticle] Layer 4 threw error: ${err.message}`);
    layer4 = { success: false, failureReason: `cache_error: ${err.message}` };
  }

  if (layer4.success) {
    console.log(`[extractArticle] Layer 4 succeeded.`);
    result.title = layer4.title;
    result.author = layer4.author;
    result.publishedAt = layer4.publishedAt;
    result.rawExtractedText = layer4.rawExtractedText;
    result.extractionMethodUsed = 'google_cache';
    result.extractionStatus = 'success';

    try {
      const $ = cheerio.load(layer4.bodyHtml || '');
      const imgs = await extractImages($, null, url);
      result.heroImageUrl = imgs.heroImageUrl || layer4.meta?.ogImage || null;
      result.additionalImageUrls = imgs.additionalImageUrls.length > 0 ? imgs.additionalImageUrls : null;
    } catch {
      result.heroImageUrl = layer4.meta?.ogImage || null;
    }
    return result;
  }

  console.log(`[extractArticle] Layer 4 failed: ${layer4.failureReason}`);

  // Layer 5: Jina AI Reader
  let layer5;
  try {
    console.log(`[extractArticle] Attempting Layer 5 (Jina AI Reader)`);
    layer5 = await layer5JinaReader(url);
  } catch (err) {
    console.error(`[extractArticle] Layer 5 threw error: ${err.message}`);
    layer5 = { success: false, failureReason: `jina_error: ${err.message}` };
  }

  if (layer5.success) {
    console.log(`[extractArticle] Layer 5 succeeded.`);
    result.title = layer5.title;
    result.author = layer5.author;
    result.publishedAt = layer5.publishedAt;
    result.rawExtractedText = layer5.rawExtractedText;
    result.extractionMethodUsed = 'jina_reader';
    result.extractionStatus = 'success';
    result.heroImageUrl = layer5.meta?.ogImage || null;
    return result;
  }

  console.log(`[extractArticle] Layer 5 failed: ${layer5.failureReason}`);

  // Layer 6: 12ft.io proxy
  let layer6;
  try {
    console.log(`[extractArticle] Attempting Layer 6 (12ft.io proxy)`);
    layer6 = await layer6TwelveFoot(url);
  } catch (err) {
    console.error(`[extractArticle] Layer 6 threw error: ${err.message}`);
    layer6 = { success: false, failureReason: `12ft_error: ${err.message}` };
  }

  if (layer6.success) {
    console.log(`[extractArticle] Layer 6 succeeded.`);
    result.title = layer6.title;
    result.author = layer6.author;
    result.publishedAt = layer6.publishedAt;
    result.rawExtractedText = layer6.rawExtractedText;
    result.extractionMethodUsed = '12ft_proxy';
    result.extractionStatus = 'success';

    try {
      const $ = cheerio.load(layer6.bodyHtml || '');
      const imgs = await extractImages($, null, url);
      result.heroImageUrl = imgs.heroImageUrl || layer6.meta?.ogImage || null;
      result.additionalImageUrls = imgs.additionalImageUrls.length > 0 ? imgs.additionalImageUrls : null;
    } catch {
      result.heroImageUrl = layer6.meta?.ogImage || null;
    }
    return result;
  }

  console.log(`[extractArticle] Layer 6 failed: ${layer6.failureReason}`);

  // Layer 7: Archive.ph
  let layer7;
  try {
    console.log(`[extractArticle] Attempting Layer 7 (Archive.ph)`);
    layer7 = await layer7ArchivePh(url);
  } catch (err) {
    console.error(`[extractArticle] Layer 7 threw error: ${err.message}`);
    layer7 = { success: false, failureReason: `archive_error: ${err.message}` };
  }

  if (layer7.success) {
    console.log(`[extractArticle] Layer 7 succeeded.`);
    result.title = layer7.title;
    result.author = layer7.author;
    result.publishedAt = layer7.publishedAt;
    result.rawExtractedText = layer7.rawExtractedText;
    result.extractionMethodUsed = 'archive_ph';
    result.extractionStatus = 'success';

    try {
      const $ = cheerio.load(layer7.bodyHtml || '');
      const imgs = await extractImages($, null, url);
      result.heroImageUrl = imgs.heroImageUrl || layer7.meta?.ogImage || null;
      result.additionalImageUrls = imgs.additionalImageUrls.length > 0 ? imgs.additionalImageUrls : null;
    } catch {
      result.heroImageUrl = layer7.meta?.ogImage || null;
    }
    return result;
  }

  console.log(`[extractArticle] Layer 7 failed: ${layer7.failureReason}`);

  // Layer 3: LLM extraction (need raw HTML)
  let rawHtml;
  if (layer2?.rawHtml) {
    console.log(`[extractArticle] Using HTML from Layer 2 (${layer2.rawHtml.length} bytes)`);
    rawHtml = layer2.rawHtml;
  } else {
    try {
      console.log(`[extractArticle] Attempting Layer 3 (LLM extraction). Fetching raw HTML...`);
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Referer': 'https://www.google.com/',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'DNT': '1',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (res.ok) rawHtml = await res.text();
      else console.log(`[extractArticle] Layer 3 fetch failed: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[extractArticle] Layer 3 fetch threw error: ${err.message}`);
    }
  }

  if (!rawHtml) {
    console.log(`[extractArticle] Layer 3 failed: could not fetch raw HTML.`);
    result.failureReason = layer7.failureReason || layer6.failureReason || layer5.failureReason || layer4.failureReason || layer2.failureReason || layer1.failureReason || 'fetch_failed';
    return result;
  }

  let layer3;
  try {
    console.log(`[extractArticle] HTML fetched (${rawHtml.length} bytes). Sending to LLM...`);
    layer3 = await layer3LlmExtraction(url, rawHtml);
  } catch (err) {
    console.error(`[extractArticle] Layer 3 threw error: ${err.message}`);
    layer3 = { success: false, failureReason: `llm_error: ${err.message}` };
  }

  if (layer3.success) {
    console.log(`[extractArticle] Layer 3 succeeded.`);
    result.title = layer3.title;
    result.author = layer3.author;
    result.publishedAt = layer3.publishedAt;
    result.rawExtractedText = layer3.rawExtractedText;
    result.extractionMethodUsed = 'llm_fallback';
    result.extractionStatus = 'success';

    try {
      const $ = cheerio.load(rawHtml);
      const imgs = await extractImages($, null, url);
      result.heroImageUrl = imgs.heroImageUrl || null;
      result.additionalImageUrls = imgs.additionalImageUrls.length > 0 ? imgs.additionalImageUrls : null;
    } catch {}
    return result;
  }

  console.log(`[extractArticle] Layer 3 failed: ${layer3.failureReason}`);

  // Layer 8: Apify Reuters scraper (last resort — only for reuters.com)
  let layer8;
  try {
    console.log(`[extractArticle] Attempting Layer 8 (Apify Reuters scraper)`);
    layer8 = await layer8ApifyReuters(url);
  } catch (err) {
    console.error(`[extractArticle] Layer 8 threw error: ${err.message}`);
    layer8 = { success: false, failureReason: `apify_error: ${err.message}` };
  }

  if (layer8.success) {
    console.log(`[extractArticle] Layer 8 succeeded.`);
    result.title = layer8.title;
    result.author = layer8.author;
    result.publishedAt = layer8.publishedAt;
    result.rawExtractedText = layer8.rawExtractedText;
    result.extractionMethodUsed = 'apify_reuters';
    result.extractionStatus = 'success';
    result.heroImageUrl = layer8.meta?.ogImage || null;
    return result;
  }

  console.log(`[extractArticle] Layer 8 failed: ${layer8.failureReason}`);

  // All layers failed
  result.failureReason = layer8.failureReason || layer3.failureReason || layer7.failureReason || layer6.failureReason || layer5.failureReason || layer4.failureReason || layer2.failureReason || layer1.failureReason || 'all_layers_failed';

  // Normalize rate-limit signals into a clean frontend-friendly message
  const hasRateLimitReason = result.failureReason?.includes('target_rate_limited')
    || result.failureReason?.includes('_429');
  const hasRateLimitPage = rawHtml && isRateLimitedPage(rawHtml);
  if (hasRateLimitReason || hasRateLimitPage) {
    result.failureReason = 'target_rate_limited';
  }

  result.extractionStatus = 'failed';
  console.log(`[extractArticle] === Extraction FAILED === Reason: ${result.failureReason}`);
  return result;
}
