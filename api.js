const BASE = import.meta.env.VITE_API_BASE_URL || ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export function fetchJobs(filters = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v && v !== 'all') params.set(k, Array.isArray(v) ? v.join(',') : v)
  })
  const qs = params.toString()
  return request(`/api/jobs${qs ? `?${qs}` : ''}`)
}

export function aiSearch(query) {
  return request('/api/ai-search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
}

export function postJob(data) {
  return request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
