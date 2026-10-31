export class CortezaApiError extends Error {
  constructor(message, status, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function createCortezaApi({
  auth,
  apiBase = '/api',
  fetch = globalThis.fetch,
}) {
  if (!apiBase.startsWith('/') || apiBase.startsWith('//'))
    throw new Error('The API must use the same origin.')

  return async function request(path, { method = 'GET', json, query } = {}) {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Invalid API path.')
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '')
        params.set(key, String(value))
    }
    const url = `${apiBase.replace(/\/$/, '')}${path}${params.size ? `?${params}` : ''}`
    const send = (token) =>
      fetch(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      })
    let response
    try {
      const token = await auth.getAccessToken()
      response = await send(token)
      // A 401 is rejected before the record operation. Never retry a 403 or an
      // ambiguous network/server failure, especially for creates and deletes.
      if (response.status === 401) {
        response = await send(
          await auth.getAccessToken({ rejectedToken: token }),
        )
        if (response.status === 401) auth.invalidate()
      }
    } catch (cause) {
      if (cause instanceof TypeError)
        throw new Error(
          'Cannot reach Corteza. Check your connection and try again.',
        )
      throw cause
    }
    let data
    try {
      data = await response.json()
    } catch {
      throw new CortezaApiError(
        'Corteza returned an unexpected response. Please try again.',
        response.status,
      )
    }
    // Corteza can return application errors inside an HTTP 200 response.
    if (!response.ok || data.error) {
      let message =
        data.error?.message || `The request failed (${response.status}).`
      if (
        response.status === 403 ||
        /notAllowed|not.allowed|permission|forbidden/i.test(message)
      )
        message = 'You do not have permission to perform this action.'
      if (/stale|changed|outdated/i.test(message))
        message =
          'This ticket was changed by someone else. Close this form and open it again to get the latest version.'
      throw new CortezaApiError(message, response.status, data.error?.details)
    }
    return data.response
  }
}
