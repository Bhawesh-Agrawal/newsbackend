// Supports: 'nvidia', 'gemini', 'openai', 'disabled'
const AI_PROVIDER = process.env.AI_PROVIDER || 'disabled';

const PROMPTS = {
  summary: (text) => `Summarise this news article in 2-3 sentences. 
Be factual, concise, and neutral in tone. 
Do not start with "This article" or "The author".
Article: ${text.slice(0, 3000)}`,
  
  tags: (title, text) => `Given this news article title and content, 
suggest 3-5 relevant tags as a JSON array of strings.
Only return the JSON array, nothing else.
Title: ${title}
Content: ${text.slice(0, 1000)}`,
};

// ── Nvidia NIM ────────────────────────────────────────────────────
const callNvidia = async (prompt) => {
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'meta/llama-3.1-8b-instruct',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  200,
      temperature: 0.3,   // low temp = more factual, less creative
    }),
  });

  if (!response.ok) {
    throw new Error(`Nvidia NIM error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
};

// ── Gemini Flash (cheapest paid option) ──────────────────────────
const callGemini = async (prompt) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.3 },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text.trim();
};

// ── Main dispatcher ───────────────────────────────────────────────
const callAI = async (prompt) => {
  switch (AI_PROVIDER) {
    case 'nvidia': return callNvidia(prompt);
    case 'gemini': return callGemini(prompt);
    case 'disabled': return null;
    default: return null;
  }
};

// ── Public functions ──────────────────────────────────────────────
export const generateSummary = async (bodyText) => {
  try {
    if (AI_PROVIDER === 'disabled') return null;
    const result = await callAI(PROMPTS.summary(bodyText));
    return result;
  } catch (err) {
    // Never let AI failure break article publishing
    console.error('[AI] Summary generation failed:', err.message);
    return null;
  }
};

export const generateTags = async (title, bodyText) => {
  try {
    if (AI_PROVIDER === 'disabled') return [];
    const result = await callAI(PROMPTS.tags(title, bodyText));

    // Parse JSON array from response
    const cleaned = result.replace(/```json|```/g, '').trim();
    const tags    = JSON.parse(cleaned);
    return Array.isArray(tags) ? tags.slice(0, 5) : [];
  } catch (err) {
    console.error('[AI] Tag generation failed:', err.message);
    return [];
  }
};
