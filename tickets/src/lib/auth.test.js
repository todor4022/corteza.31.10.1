import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { AUTH_STORAGE, AuthenticationError, createCortezaAuth } from './auth.js'

function browser(path = '/tickets/', stored = []) {
  const entries = new Map(stored)
  const events = new Map()
  const timers = new Map()
  const location = {
    origin: 'https://example.test',
    href: `https://example.test${path}`,
    assign(url) {
      this.assigned = url
    },
  }
  return {
    location,
    crypto: webcrypto,
    entries,
    timers,
    events,
    sessionStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, String(value)),
      removeItem: (key) => entries.delete(key),
    },
    history: {
      replaceState: (_state, _title, url) => {
        location.href = new URL(url, location.origin).href
      },
    },
    setTimeout: (fn) => {
      const id = Symbol()
      timers.set(id, fn)
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name) => events.delete(name),
  }
}

const tokens = (suffix = 'one') => ({
  access_token: `access-${suffix}`,
  refresh_token: `refresh-${suffix}`,
  sub: '123456789012345678',
  email: 'person@example.test',
  expires_in: 300,
})
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), { status })

async function signedIn(fetchNext) {
  const state = 'expected-state'
  const win = browser(
    `/tickets/auth/callback?code=one-use-code&state=${state}`,
    [
      [
        AUTH_STORAGE.pending,
        JSON.stringify({
          state,
          returnTo: 'https://example.test/tickets/?view=all',
          startedAt: Date.now(),
        }),
      ],
      ['other-app.setting', 'keep'],
    ],
  )
  let calls = 0
  const auth = createCortezaAuth({
    browser: win,
    fetch: async (...args) =>
      ++calls === 1 ? response(tokens()) : fetchNext(...args),
  })
  assert.equal(await auth.initialize(), true)
  return { auth, win }
}

test('first visit starts Corteza OAuth with cryptographic state and no browser client secret', async () => {
  const win = browser('/tickets/?view=all', [['other-app.setting', 'keep']])
  const auth = createCortezaAuth({
    browser: win,
    fetch: () => assert.fail('no token exchange before callback'),
  })
  await auth.initialize()
  const redirect = new URL(win.location.assigned)
  assert.equal(redirect.pathname, '/auth/oauth2/default-client')
  assert.equal(redirect.searchParams.get('scope'), 'profile api')
  assert.equal(
    redirect.searchParams.get('redirect_uri'),
    'https://example.test/tickets/auth/callback',
  )
  assert.match(redirect.searchParams.get('state'), /^[a-f0-9]{64}$/)
  assert.equal(redirect.searchParams.has('client_secret'), false)
  assert.equal(win.entries.get('other-app.setting'), 'keep')
  auth.dispose()
})

test('callback verifies state, cleans URL, stores only refresh token, and keeps the real user ID', async () => {
  const { auth, win } = await signedIn(() => assert.fail('unexpected refresh'))
  assert.equal(auth.user.value.userID, '123456789012345678')
  assert.equal(await auth.getAccessToken(), 'access-one')
  assert.equal(win.location.href, 'https://example.test/tickets/?view=all')
  assert.equal(win.entries.has(AUTH_STORAGE.pending), false)
  assert.equal(win.entries.get(AUTH_STORAGE.refresh), 'refresh-one')
  assert.equal([...win.entries.values()].includes('access-one'), false)
  auth.dispose()
})

for (const [label, state, pending] of [
  ['missing state', '', { state: 'expected', startedAt: Date.now() }],
  ['mismatched state', 'wrong', { state: 'expected', startedAt: Date.now() }],
  [
    'expired state',
    'expected',
    { state: 'expected', startedAt: Date.now() - 700_000 },
  ],
  ['unsolicited callback', 'expected', null],
]) {
  test(`rejects ${label} before exchanging a code`, async () => {
    const win = browser(`/tickets/auth/callback?code=secret&state=${state}`, [
      [AUTH_STORAGE.pending, JSON.stringify(pending)],
    ])
    const auth = createCortezaAuth({
      browser: win,
      fetch: () => assert.fail('must not exchange code'),
    })
    assert.equal(await auth.initialize(), false)
    assert.equal(auth.status.value, 'unauthenticated')
    assert.equal(win.location.href, 'https://example.test/tickets/')
    assert.equal(win.entries.has(AUTH_STORAGE.pending), false)
    auth.dispose()
  })
}

test('rejects an external return URL', async () => {
  const win = browser('/tickets/auth/callback?code=code&state=expected', [
    [
      AUTH_STORAGE.pending,
      JSON.stringify({
        state: 'expected',
        returnTo: 'https://evil.test/',
        startedAt: Date.now(),
      }),
    ],
  ])
  const auth = createCortezaAuth({
    browser: win,
    fetch: async () => response(tokens()),
  })
  await auth.initialize()
  assert.equal(win.location.href, 'https://example.test/tickets/')
  auth.dispose()
})

test('a copied tab obtains its own grant without consuming the original refresh token', async () => {
  const win = browser('/tickets/', [
    [AUTH_STORAGE.active, '1'],
    [AUTH_STORAGE.refresh, 'copied-token'],
  ])
  const auth = createCortezaAuth({
    browser: win,
    fetch: () => assert.fail('must not use copied token'),
  })
  await auth.initialize()
  assert.ok(win.location.assigned)
  assert.equal(win.entries.has(AUTH_STORAGE.refresh), false)
  auth.dispose()
})

test('normal reload can refresh after pagehide removes only the active-tab marker', async () => {
  const { auth, win } = await signedIn()
  win.events.get('pagehide')()
  assert.equal(win.entries.has(AUTH_STORAGE.active), false)
  assert.equal(win.entries.get(AUTH_STORAGE.refresh), 'refresh-one')
  assert.equal(win.entries.get('other-app.setting'), 'keep')
  assert.equal(win.timers.size, 0)
  auth.dispose()
  const next = createCortezaAuth({
    browser: win,
    fetch: async () => response(tokens('two')),
  })
  assert.equal(await next.initialize(), true)
  assert.equal(await next.getAccessToken(), 'access-two')
  next.dispose()
})

test('concurrent rejected requests share one refresh and rotate the refresh token', async () => {
  let calls = 0
  const { auth, win } = await signedIn(async (_url, options) => {
    calls++
    assert.equal(options.body.get('refresh_token'), 'refresh-one')
    await new Promise((resolve) => setImmediate(resolve))
    return response(tokens('two'))
  })
  assert.deepEqual(
    await Promise.all(
      Array.from({ length: 5 }, () =>
        auth.getAccessToken({ rejectedToken: 'access-one' }),
      ),
    ),
    Array(5).fill('access-two'),
  )
  assert.equal(calls, 1)
  assert.equal(win.entries.get(AUTH_STORAGE.refresh), 'refresh-two')
  assert.equal(
    await auth.getAccessToken({ rejectedToken: 'access-one' }),
    'access-two',
  )
  assert.equal(calls, 1)
  auth.dispose()
})

test('an invalid refresh clears only Tickets credentials', async () => {
  const { auth, win } = await signedIn(async () =>
    response({ error: 'invalid_grant' }, 400),
  )
  await assert.rejects(
    auth.getAccessToken({ rejectedToken: 'access-one' }),
    AuthenticationError,
  )
  assert.equal(auth.status.value, 'unauthenticated')
  assert.equal(auth.user.value, null)
  assert.equal(win.entries.has(AUTH_STORAGE.refresh), false)
  assert.equal(win.entries.get('other-app.setting'), 'keep')
  auth.dispose()
})

test('a temporary network failure preserves refresh credentials for retry', async () => {
  let fail = true
  const { auth, win } = await signedIn(async () => {
    if (fail) throw new TypeError('network failed')
    return response(tokens('two'))
  })
  await assert.rejects(
    auth.getAccessToken({ rejectedToken: 'access-one' }),
    /Cannot reach Corteza/,
  )
  assert.equal(win.entries.get(AUTH_STORAGE.refresh), 'refresh-one')
  assert.equal(auth.status.value, 'authenticated')
  fail = false
  assert.equal(
    await auth.getAccessToken({ rejectedToken: 'access-one' }),
    'access-two',
  )
  auth.dispose()
})

test('logout during an in-flight refresh cannot resurrect the session', async () => {
  let finish
  const { auth, win } = await signedIn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const refreshing = auth.getAccessToken({ rejectedToken: 'access-one' })
  auth.logout()
  finish(response(tokens('two')))
  await assert.rejects(refreshing, AuthenticationError)
  assert.equal(auth.status.value, 'unauthenticated')
  assert.equal(win.entries.has(AUTH_STORAGE.refresh), false)
  assert.equal(win.entries.get('other-app.setting'), 'keep')
  assert.equal(new URL(win.location.assigned).pathname, '/auth/logout')
  auth.dispose()
})
