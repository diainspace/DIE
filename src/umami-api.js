export async function umamiRequest(path, { method = 'GET', body } = {}) {
  const base = process.env.UMAMI_BASE_URL;
  const key = process.env.UMAMI_API_KEY;

  if (!base || !key) {
    throw new Error('Umami API configuration is missing');
  }

  if (!path.startsWith('/api/')) {
    throw new Error('Invalid Umami API path');
  }

  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    throw new Error(`Umami API returned status ${response.status}`);
  }

  return response.json();
}
