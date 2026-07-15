const MODEL = 'meta/llama-3.1-8b-instruct';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const STORY_PROMPT = (title, author, text) => `You are a skilled narrative writer. Rewrite the following news article as a SHORT story — exactly 80 to 100 words. NOT more.

RULES:
- Stay strictly within 80-100 words. This is a hard limit.
- Only use facts, names, and details explicitly present in the source text below. Do not invent or infer information.
- Do not copy more than a few short phrases verbatim. Paraphrase throughout for copyright safety.
- Write in a narrative, storytelling tone — not bullet points, not a news lede. Make it read like a story.
- Preserve the key facts: who, what, when, where, why, and how.
- Do not start sentences with "This article" or "The author".
- If the source includes quotes, weave them naturally into the narrative.

Article Title: ${title || 'Unknown'}
${author ? `Author: ${author}` : ''}

Source Text:
${text.slice(0, 6000)}

Write the short story now — 80 to 100 words maximum. Output ONLY the story text — no headings, no labels, no meta-commentary.`;

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

    result.shortStoryContent = content;
    result.aiModelUsed = MODEL;
    return result;
  } catch (err) {
    console.error('[StoryGen] Failed:', err.message);
    return result;
  }
}
