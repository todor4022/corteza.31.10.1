import { readonly, shallowRef } from 'vue'

// Adapted from Corteza's lib/vue/src/plugins/auth.ts (Apache-2.0).
// The default-client endpoint keeps the OAuth client secret on the server.
export const AUTH_STORAGE = {
  refresh: 'tickets.auth.refresh-token',
  pending: 'tickets.auth.pending',
  active: 'tickets.auth.active-tab',
}

export class AuthenticationError extends Error {}

export function createCortezaAuth({
  browser,
  authBase = '/auth',
  appBase = '/tickets/',
  fetch = browser.fetch.bind(browser),
}) {
  const user = shallowRef(null)
  const status = shallowRef('loading')
  const error = shallowRef('')
  const storage = browser.sessionStorage
  const origin = browser.location.origin
  const appUrl = new URL(appBase, origin)
  const callbackUrl = new URL('auth/callback', appUrl)
  const flowUrl = new URL(
    `${authBase.replace(/\/$/, '')}/oauth2/default-client`,
    origin,
  )
  if (flowUrl.origin !== origin)
    throw new Error('Tickets authentication must use the same origin.')

  let accessToken
  let expiresAt = 0
  let timer
  let refreshPromise
  let initialization
  let generation = 0
  let channel

  function stopTimer() {
    browser.clearTimeout(timer)
    timer = undefined
  }

  function clearSession(message = '') {
    generation++
    stopTimer()
    accessToken = undefined
    expiresAt = 0
    user.value = null
    for (const key of Object.values(AUTH_STORAGE)) storage.removeItem(key)
    error.value = message
    status.value = 'unauthenticated'
  }

  function returnLocation(candidate) {
    const url = new URL(candidate || appUrl, origin)
    const root = appUrl.pathname.replace(/\/$/, '')
    if (
      url.origin !== origin ||
      !(url.pathname === root || url.pathname.startsWith(`${root}/`)) ||
      url.pathname === callbackUrl.pathname
    ) {
      return appUrl.href
    }
    return url.href
  }

  function scheduleRefresh(delay) {
    stopTimer()
    timer = browser.setTimeout(() => {
      refresh().catch(() => {
        // A temporary network failure must not discard a usable refresh token.
        if (status.value === 'authenticated') scheduleRefresh(15_000)
      })
    }, delay)
  }

  async function exchange(parameters) {
    let response
    try {
      response = await fetch(flowUrl.href, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(parameters),
      })
    } catch {
      throw new Error(
        'Cannot reach Corteza. Check your connection and try again.',
      )
    }
    let data
    try {
      data = await response.json()
    } catch {
      throw new Error('Corteza returned an unexpected sign-in response.')
    }
    if (!response.ok || data.error) {
      if (data.error === 'invalid_grant' || data.error === 'invalid_token') {
        throw new AuthenticationError(
          'Your sign-in has expired. Please sign in again.',
        )
      }
      throw new Error('Corteza could not complete sign-in. Please try again.')
    }
    return data
  }

  function acceptTokens(data, expectedGeneration) {
    if (generation !== expectedGeneration)
      throw new AuthenticationError('Please sign in again.')
    if (
      !data.access_token ||
      !data.refresh_token ||
      !data.sub ||
      !(Number(data.expires_in) > 0)
    ) {
      throw new Error('Corteza returned an incomplete sign-in response.')
    }
    storage.setItem(AUTH_STORAGE.refresh, data.refresh_token)
    accessToken = data.access_token
    expiresAt = Date.now() + Number(data.expires_in) * 1000
    user.value = {
      userID: String(data.sub),
      name: data.name || '',
      email: data.email || '',
      handle: data.handle || '',
    }
    status.value = 'authenticated'
    error.value = ''
    scheduleRefresh(Number(data.expires_in) * 750)
    return accessToken
  }

  function refresh() {
    if (refreshPromise) return refreshPromise
    const refreshToken = storage.getItem(AUTH_STORAGE.refresh)
    if (!refreshToken)
      return Promise.reject(
        new AuthenticationError('Please sign in to continue.'),
      )
    const expectedGeneration = generation
    const pending = exchange({ refresh_token: refreshToken })
      .then((data) => acceptTokens(data, expectedGeneration))
      .catch((cause) => {
        if (
          cause instanceof AuthenticationError &&
          generation === expectedGeneration
        )
          clearSession(cause.message)
        throw cause
      })
      .finally(() => {
        if (refreshPromise === pending) refreshPromise = undefined
      })
    refreshPromise = pending
    return pending
  }

  async function getAccessToken({ rejectedToken } = {}) {
    // Another request may already have refreshed the token rejected by the API.
    if (
      accessToken &&
      Date.now() < expiresAt - 30_000 &&
      (!rejectedToken || rejectedToken !== accessToken)
    )
      return accessToken
    return refresh()
  }

  async function login() {
    try {
      clearSession()
      const stateBytes = browser.crypto.getRandomValues(new Uint8Array(32))
      const state = Array.from(stateBytes, (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      storage.setItem(
        AUTH_STORAGE.pending,
        JSON.stringify({
          state,
          returnTo: returnLocation(browser.location.href),
          startedAt: Date.now(),
        }),
      )
      const url = new URL(flowUrl)
      url.search = new URLSearchParams({
        redirect_uri: callbackUrl.href,
        scope: 'profile api',
        state,
      }).toString()
      status.value = 'redirecting'
      browser.location.assign(url.href)
    } catch {
      status.value = 'error'
      error.value =
        'Could not start sign-in. Allow session storage in your browser and try again.'
    }
    return false
  }

  async function initialize() {
    if (status.value === 'authenticated') return true
    if (initialization) return initialization
    const pending = (async () => {
      status.value = 'loading'
      error.value = ''
      const entry = new URL(browser.location.href)
      if (entry.pathname === callbackUrl.pathname) {
        let saved
        try {
          saved = JSON.parse(storage.getItem(AUTH_STORAGE.pending))
        } catch {
          /* invalid state is rejected below */
        }
        storage.removeItem(AUTH_STORAGE.pending)
        // Remove the one-use code even when the callback is rejected.
        browser.history.replaceState(null, '', returnLocation(saved?.returnTo))
        if (
          !saved?.state ||
          entry.searchParams.get('state') !== saved.state ||
          !saved.startedAt ||
          Date.now() - saved.startedAt > 600_000 ||
          saved.startedAt > Date.now()
        ) {
          throw new AuthenticationError(
            'The sign-in response could not be verified. Please sign in again.',
          )
        }
        if (entry.searchParams.has('error'))
          throw new AuthenticationError(
            'Sign-in was cancelled or denied. Please sign in again to continue.',
          )
        const code = entry.searchParams.get('code')
        if (!code)
          throw new AuthenticationError(
            'The sign-in response is incomplete. Please sign in again.',
          )
        const expectedGeneration = generation
        acceptTokens(
          await exchange({
            code,
            redirect_uri: callbackUrl.href,
            scope: 'profile api',
          }),
          expectedGeneration,
        )
      } else {
        // sessionStorage is copied when a tab is duplicated. Give the new tab its
        // own OAuth grant so it cannot rotate the original tab's refresh token.
        if (storage.getItem(AUTH_STORAGE.active))
          storage.removeItem(AUTH_STORAGE.refresh)
        storage.setItem(AUTH_STORAGE.active, '1')
        if (!storage.getItem(AUTH_STORAGE.refresh)) return login()
        try {
          await refresh()
        } catch (cause) {
          if (cause instanceof AuthenticationError) return login()
          throw cause
        }
      }
      storage.setItem(AUTH_STORAGE.active, '1')
      return true
    })()
      .catch((cause) => {
        error.value = cause.message || 'Could not sign in. Please try again.'
        status.value =
          cause instanceof AuthenticationError ? 'unauthenticated' : 'error'
        return false
      })
      .finally(() => {
        if (initialization === pending) initialization = undefined
      })
    initialization = pending
    return pending
  }

  function logout() {
    clearSession()
    channel?.postMessage('logout')
    const url = new URL(`${authBase.replace(/\/$/, '')}/logout`, origin)
    url.searchParams.set('back', appUrl.href)
    browser.location.assign(url.href)
  }

  function onPageHide() {
    storage.removeItem(AUTH_STORAGE.active)
    stopTimer()
  }

  function onPageShow(event) {
    if (event.persisted) {
      storage.setItem(AUTH_STORAGE.active, '1')
      if (status.value === 'authenticated') refresh().catch(() => {})
    }
  }

  browser.addEventListener('pagehide', onPageHide)
  browser.addEventListener('pageshow', onPageShow)
  if (browser.BroadcastChannel) {
    channel = new browser.BroadcastChannel('tickets.auth')
    channel.onmessage = (event) => {
      if (event.data === 'logout')
        clearSession('You have signed out. Please sign in again.')
    }
  }

  return {
    user: readonly(user),
    status: readonly(status),
    error: readonly(error),
    initialize,
    login,
    logout,
    getAccessToken,
    invalidate: () =>
      clearSession('Your sign-in has expired. Please sign in again.'),
    dispose() {
      generation++
      stopTimer()
      browser.removeEventListener('pagehide', onPageHide)
      browser.removeEventListener('pageshow', onPageShow)
      channel?.close()
    },
  }
}
