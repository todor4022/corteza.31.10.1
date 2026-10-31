import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTicketRepository,
  ticketForm,
  ticketValues,
  localDateTime,
} from './tickets.js'

const module = {
  namespaceID: '123456789012345678',
  moduleID: '223456789012345678',
  fields: ['Subject', 'Description', 'Status', 'Priority', 'DueDate'].map(
    (name) => ({ name, canReadRecordValue: true, canUpdateRecordValue: true }),
  ),
}
const record = {
  recordID: '323456789012345678',
  createdBy: 'real-user',
  ownedBy: 'other-owner',
  meta: { seedKey: 'preserve' },
  values: [
    { name: 'Subject', value: 'Original' },
    { name: 'Description', value: 'Keep this' },
    { name: 'Status', value: 'New' },
    { name: 'Priority', value: 'Medium' },
    { name: 'DueDate', value: '2026-11-03T10:30:45.123Z' },
    { name: 'ExtraField', value: 'Keep this too' },
  ],
}

test('an edit patches only changed fields on one exact ID, without sending actor, owner or metadata', async () => {
  const calls = []
  const repository = createTicketRepository(async (...args) => calls.push(args))
  const form = {
    ...ticketForm(module, record),
    Subject: 'Updated',
    createdBy: 'spoofed',
  }
  await repository.save(module, form, record)
  assert.deepEqual(calls, [
    [
      '/compose/namespace/123456789012345678/module/223456789012345678/record/',
      {
        method: 'PATCH',
        json: {
          query: 'id = 323456789012345678',
          values: [{ name: 'Subject', value: 'Updated', place: 0 }],
        },
      },
    ],
  ])
})

test('unchanged dates retain their precise stored value by being omitted from the patch', () => {
  assert.deepEqual(ticketValues(module, ticketForm(module, record), record), [])
})

test('read-only and unreadable fields cannot be included in a forged form submission', () => {
  const restricted = {
    ...module,
    fields: module.fields.map((field) => ({
      ...field,
      canUpdateRecordValue: field.name !== 'Subject',
      canReadRecordValue: field.name !== 'Priority',
    })),
  }
  const form = {
    ...ticketForm(restricted, record),
    Subject: 'Forbidden',
    Priority: 'Urgent',
    Description: 'Allowed',
  }
  assert.deepEqual(ticketValues(restricted, form, record), [
    { name: 'Description', value: 'Allowed', place: 0 },
  ])
})

test('clearing optional fields sends explicit empty values', () => {
  const form = { ...ticketForm(module, record), Description: '', DueDate: '' }
  assert.deepEqual(ticketValues(module, form, record), [
    { name: 'Description', value: '', place: 0 },
    { name: 'DueDate', value: '', place: 0 },
  ])
})

test('local due dates are converted to UTC for storage', () => {
  const form = { ...ticketForm(module, record), DueDate: '2026-11-03T14:15:30' }
  assert.deepEqual(ticketValues(module, form, record), [
    { name: 'DueDate', value: new Date(form.DueDate).toISOString(), place: 0 },
  ])
  assert.equal(
    localDateTime(new Date(form.DueDate).toISOString()),
    form.DueDate,
  )
})

test('creating a record sends only allowed ticket values', async () => {
  let payload
  const repository = createTicketRepository(async (_path, options) => {
    payload = options.json
  })
  await repository.save(module, {
    Subject: '  A new ticket  ',
    Status: 'New',
    Priority: 'Medium',
    createdBy: 'admin',
    ownedBy: 'admin',
  })
  assert.deepEqual(Object.keys(payload), ['values'])
  assert.equal(
    payload.values.find((value) => value.name === 'Subject').value,
    'A new ticket',
  )
  assert.equal(
    payload.values.some((value) =>
      ['createdBy', 'ownedBy'].includes(value.name),
    ),
    false,
  )
})

test('an injected record ID cannot broaden the PATCH filter', async () => {
  const repository = createTicketRepository(() =>
    assert.fail('must not send request'),
  )
  await assert.rejects(
    repository.save(
      module,
      { ...ticketForm(module, record), Subject: 'Updated' },
      { ...record, recordID: '1 OR 1=1' },
    ),
    /Invalid ticket identifier/,
  )
})

test('ticket choices and defaults come from module metadata', () => {
  const definition = {
    ...module,
    fields: module.fields.map((field) => ({
      ...field,
      options: {
        options:
          field.name === 'Status' ? ['Queued', 'Done'] : ['Normal', 'Critical'],
      },
    })),
  }
  const form = ticketForm(definition)
  assert.equal(form.Status, 'Queued')
  assert.equal(form.Priority, 'Normal')
})
