import test from 'node:test'
import assert from 'node:assert/strict'
import { createCortezaApi, CortezaApiError } from './api.js'

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), { status })

test('a rejected bearer token is refreshed once and retried with the new token', async () => {
  const seen = []
  const auth = {
    getAccessToken: async (options) =>
      options?.rejectedToken ? 'new-token' : 'old-token',
  }
  const request = createCortezaApi({
    auth,
    fetch: async (_url, options) => {
      seen.push(options.headers.Authorization)
      return seen.length === 1
        ? response({ error: {} }, 401)
        : response({ response: { set: [] } })
    },
  })
  assert.deepEqual(await request('/compose/namespace/'), { set: [] })
  assert.deepEqual(seen, ['Bearer old-token', 'Bearer new-token'])
})

for (const [label, reply] of [
  ['HTTP 403', () => response({ error: { message: 'Forbidden' } }, 403)],
  [
    'Corteza permission error in HTTP 200',
    () =>
      response({
        error: { message: 'compose.record.errors.notAllowedToUpdate' },
      }),
  ],
  [
    'server failure',
    () => response({ error: { message: 'Unavailable' } }, 503),
  ],
]) {
  test(`${label} is surfaced without retrying a write`, async () => {
    let calls = 0
    const request = createCortezaApi({
      auth: { getAccessToken: async () => 'user-token' },
      fetch: async () => {
        calls++
        return reply()
      },
    })
    await assert.rejects(
      request('/compose/record/', { method: 'POST', json: { values: [] } }),
      CortezaApiError,
    )
    assert.equal(calls, 1)
  })
}

test('a network failure never retries a possibly completed create', async () => {
  let calls = 0
  const request = createCortezaApi({
    auth: { getAccessToken: async () => 'user-token' },
    fetch: async () => {
      calls++
      throw new TypeError('network')
    },
  })
  await assert.rejects(
    request('/compose/record/', { method: 'POST', json: { values: [] } }),
    /Cannot reach Corteza/,
  )
  assert.equal(calls, 1)
})

test('validation details survive Corteza HTTP 200 error envelopes', async () => {
  const details = [
    {
      kind: 'empty',
      meta: { field: 'Subject' },
      message: 'Subject is required',
    },
  ]
  const request = createCortezaApi({
    auth: { getAccessToken: async () => 'user-token' },
    fetch: async () =>
      response({ error: { message: 'Invalid values', details } }),
  })
  await assert.rejects(request('/compose/record/'), (cause) => {
    assert.deepEqual(cause.details, details)
    return true
  })
})

test('bearer tokens cannot be sent to an arbitrary external API', async () => {
  assert.throws(
    () => createCortezaApi({ auth: {}, apiBase: '//evil.test' }),
    /same origin/,
  )
  const request = createCortezaApi({
    auth: {},
    fetch: () => assert.fail('no external request'),
  })
  await assert.rejects(request('//evil.test'), /Invalid API path/)
})
