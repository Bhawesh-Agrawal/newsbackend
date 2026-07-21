const MODEL = 'meta/llama-3.1-8b-instruct';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const BULLET_STRIP = /^[•●▪▸►➢→\-\*]\s*/;
const BULLET_SPLIT = /[•●▪▸►➢→\-\*]\s*(?=[A-Z])/;

function normalizeBullets(raw) {
  if (raw.includes('\n')) {
    return raw.split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `• ${l.replace(BULLET_STRIP, '')}`)
      .join('\n');
  }

  const parts = raw.split(BULLET_SPLIT).map((s) => s.trim()).filter(Boolean);
  const merged = [];
  for (const part of parts) {
    if (merged.length > 0 && /^[a-z]/.test(part)) {
      merged[merged.length - 1] += ` • ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.map((p) => `• ${p.replace(BULLET_STRIP, '')}`).join('\n');
}

const STORY_PROMPT = (title, author, text) => `You are a news summarizer. Rewrite the following news article as 4 to 6 concise bullet points capturing the main facts.

RULES:
- Total word count must be 80-100 words across ALL bullet points combined.
- Each bullet point must start with a bullet symbol "•" followed by a space.
- Only use facts, names, and details explicitly present in the source text below. Do not invent or infer information.
- Do not copy more than a few short phrases verbatim. Paraphrase throughout for copyright safety.
- Each bullet should capture one key fact: who, what, when, where, why, or how.
- No intros, no conclusions, no filler. Just the facts.

Article Title: ${title || 'Unknown'}
${author ? `Author: ${author}` : ''}

Source Text:
${text.slice(0, 6000)}

Output ONLY the bullet points — one per line, no headings, no labels, no meta-commentary.`;

export async function generateShortStory(rawText, title, author) {
  const result = { shortStoryContent: null, aiModelUsed: null };

  if (!rawText || rawText.length < 100) {
    return result;
  }

  try {
    const res = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: STORY_PROMPT(title, author, rawText) }],
        max_tokens: 200,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      console.error(`[StoryGen] NVIDIA NIM error: ${res.status}`);
      return result;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content || content.length < 50) {
      console.error('[StoryGen] Empty or too-short response from LLM');
      return result;
    }

    result.shortStoryContent = normalizeBullets(content);
    console.log('[StoryGen] Raw response:\n', content);
    console.log('[StoryGen] Normalized:\n', result.shortStoryContent);
    result.aiModelUsed = MODEL;
    return result;
  } catch (err) {
    console.error('[StoryGen] Failed:', err.message);
    return result;
  }
}
