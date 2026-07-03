const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

export async function notifyN8n(article) {
  if (!N8N_WEBHOOK_URL) return;

  const payload = {
    event: 'article_published',
    article: {
      title: article.title,
      ai_summary: article.ai_summary || null,
      excerpt: article.excerpt || null,
      cover_image: article.cover_image || null,
    },
  };

  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[n8n] HTTP ${res.status}: ${body}`);
    } else {
      console.log(`[n8n] Webhook sent for "${article.title}"`);
    }
  } catch (err) {
    console.error(`[n8n] Webhook failed for "${article.title}":`, err.message);
  }
}
