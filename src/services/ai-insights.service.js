import sql from '../config/database.js';
import { memCache } from '../utils/memCache.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── Rate limiting ────────────────────────────────────────────────────────────
let lastCallTime = 0;
const MIN_CALL_INTERVAL = 2000; // 2 seconds between calls

async function rateLimitedGemini(prompt) {
  const now = Date.now();
  const wait = MIN_CALL_INTERVAL - (now - lastCallTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallTime = Date.now();

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Title Suggestions ────────────────────────────────────────────────────────
export async function generateTitleSuggestions(topic, existingTitles = []) {
  const cacheKey = `gemini:titles:${topic}`;
  const cached = memCache.get(cacheKey);
  if (cached) return cached;

  const prompt = `You are an expert SEO headline writer for an Indian business news site called Mango People News.

Topic: "${topic}"

${existingTitles.length > 0 ? `Recent headlines that performed well:\n${existingTitles.slice(0, 5).map(t => `- "${t.title}" (${t.views} views, ${(t.ctr * 100).toFixed(1)}% CTR)`).join('\n')}` : ''}

Generate 10 headline options optimized for Google search clicks. Consider:
1. Include numbers when relevant (lists, stats, comparisons)
2. Use power words that drive clicks (essential, surprising, proven, complete)
3. Keep under 60 characters for Google SERP display
4. Match search intent (informational, commercial, comparison)
5. Reference patterns from existing high-performing titles if provided

Return as JSON array with objects: { "title": string, "style": string, "predicted_ctr": "high"|"medium", "reason": string }
Only return the JSON array, no other text.`;

  try {
    const result = await rateLimitedGemini(prompt);
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      const suggestions = JSON.parse(match[0]);
      memCache.set(cacheKey, suggestions, CACHE_TTL);
      return suggestions;
    }
    return [];
  } catch (err) {
    console.error('[Gemini] Title generation error:', err.message);
    return [];
  }
}

// ── Content Gap Analysis ─────────────────────────────────────────────────────
export async function analyzeContentGaps(siteArticles, competitorKeywords = []) {
  const cacheKey = 'gemini:content-gaps';
  const cached = memCache.get(cacheKey);
  if (cached) return cached;

  const topicSummary = siteArticles
    .slice(0, 50)
    .map(a => `- "${a.title}" (${a.category_name}, ${a.view_count} views)`)
    .join('\n');

  const prompt = `You are an SEO content strategist for an Indian business news site.

Current published articles (last 90 days):
${topicSummary}

${competitorKeywords.length > 0 ? `\nKeywords competitors rank for but we don't cover:\n${competitorKeywords.join('\n')}` : ''}

Analyze and identify:
1. TOPIC GAPS: Topics our audience searches for but we haven't covered
2. CONTENT DEPTH GAPS: Topics we touch on briefly but should cover comprehensively
3. FORMAT GAPS: Content types we're missing (guides, comparisons, data-driven pieces)
4. SEASONAL OPPORTUNITIES: Upcoming topics based on the current month

Return as JSON array: { "gap": string, "priority": "high"|"medium"|"low", "search_potential": string, "suggested_title": string }
Only return the JSON array, no other text.`;

  try {
    const result = await rateLimitedGemini(prompt);
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      const gaps = JSON.parse(match[0]);
      memCache.set(cacheKey, gaps, CACHE_TTL);
      return gaps;
    }
    return [];
  } catch (err) {
    console.error('[Gemini] Content gap analysis error:', err.message);
    return [];
  }
}

// ── Article Performance Prediction ───────────────────────────────────────────
export async function predictArticlePerformance(title, category, readingTime, publishHour) {
  const prompt = `You are a news content performance predictor for an Indian business news site called Mango People News.

Article details:
- Title: "${title}"
- Category: ${category}
- Reading time: ${readingTime} minutes
- Planned publish hour: ${publishHour}:00 IST

Based on typical Indian news audience patterns, predict:
1. Expected engagement level: "viral" / "high" / "average" / "low"
2. Predicted first-24h views range
3. Quality read rate prediction (% who actually read vs skim)
4. Best category match assessment
5. Title effectiveness score (1-10)
6. One improvement suggestion

Return as JSON: { "engagement_level": string, "views_24h": string, "quality_read_prediction": string, "title_score": number, "suggestion": string }
Only return the JSON, no other text.`;

  try {
    const result = await rateLimitedGemini(prompt);
    const match = result.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch (err) {
    console.error('[Gemini] Prediction error:', err.message);
    return null;
  }
}

// ── AI Search Optimization ───────────────────────────────────────────────────
export async function analyzeAISearchReadiness(articleBody) {
  const cacheKey = `gemini:ai-readiness:${Buffer.from(articleBody.slice(0, 200)).toString('base64').slice(0, 32)}`;

  const prompt = `Analyze this article content for AI search readiness (Google AI Overviews, ChatGPT, Perplexity).

Article content (first 2000 chars):
${articleBody.slice(0, 2000)}

Evaluate:
1. Structure: Is it well-structured with clear headings, lists, and sections?
2. Factual density: Does it contain specific facts, data, and quotes?
3. Question answering: Does it directly answer common questions?
4. E-E-A-T signals: Does it demonstrate expertise, authoritativeness, trustworthiness?
5. Schema potential: What structured data could be added?

Return as JSON: { "score": number (1-10), "strengths": string[], "weaknesses": string[], "improvements": string[] }
Only return the JSON, no other text.`;

  try {
    const result = await rateLimitedGemini(prompt);
    const match = result.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch (err) {
    console.error('[Gemini] AI search analysis error:', err.message);
    return null;
  }
}

// ── Topic Cluster Suggestion ─────────────────────────────────────────────────
export async function suggestTopicClusters(articles) {
  const cacheKey = 'gemini:cluster-suggestions';
  const cached = memCache.get(cacheKey);
  if (cached) return cached;

  const articleList = articles
    .slice(0, 100)
    .map(a => `- "${a.title}" (id: ${a.id}, category: ${a.category_name}, views: ${a.view_count})`)
    .join('\n');

  const prompt = `You are a content strategist. Group these articles into topic clusters (hub-and-spoke model).

Articles:
${articleList}

Identify:
1. Natural topic clusters (group related articles)
2. Pillar article candidates (highest authority articles in each cluster)
3. Missing spokes (gaps in each cluster)
4. Cross-cluster linking opportunities

Return as JSON array: { "cluster_name": string, "pillar_article_id": string, "article_ids": string[], "missing_spokes": string[], "linking_suggestions": string[] }
Only return the JSON array, no other text.`;

  try {
    const result = await rateLimitedGemini(prompt);
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      const clusters = JSON.parse(match[0]);
      memCache.set(cacheKey, clusters, CACHE_TTL);
      return clusters;
    }
    return [];
  } catch (err) {
    console.error('[Gemini] Cluster suggestion error:', err.message);
    return [];
  }
}
