const INDEXNOW_KEY = '42e18680c8fc480f95a1fe0abc0b4379'
const SITE_URL     = 'https://www.mangopeoplenews.com'

export async function submitToIndexNow(slug) {
  const payload = {
    host: 'www.mangopeoplenews.com',
    key: INDEXNOW_KEY,
    keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
    urlList: [`${SITE_URL}/article/${slug}`],
  }

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[IndexNow] HTTP ${res.status} for /article/${slug}: ${body}`)
    } else {
      console.log(`[IndexNow] Submitted /article/${slug}`)
    }
  } catch (err) {
    console.error(`[IndexNow] Failed for /article/${slug}:`, err.message)
  }
}
