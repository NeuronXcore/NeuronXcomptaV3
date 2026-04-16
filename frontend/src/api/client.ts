const BASE_URL = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Ne déclarer Content-Type: application/json QUE si un body est réellement présent.
  // Sans ce garde, POST/PATCH sans body envoient un header incohérent (Content-Type JSON
  // sans payload) qui peut déclencher un 400 côté FastAPI/proxy Vite.
  const baseHeaders: Record<string, string> = {}
  if (options?.body !== undefined && options?.body !== null) {
    baseHeaders['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...baseHeaders, ...options?.headers },
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: async <T>(path: string, file: File): Promise<T> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', body: formData })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(error.detail || `HTTP ${res.status}`)
    }
    return res.json()
  },
  uploadMultiple: async <T>(path: string, files: File[]): Promise<T> => {
    const formData = new FormData()
    files.forEach(file => formData.append('files', file))
    const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', body: formData })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(error.detail || `HTTP ${res.status}`)
    }
    return res.json()
  },
}
