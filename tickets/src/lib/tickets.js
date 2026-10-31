export const TICKET_FIELDS = [
  'Subject',
  'Description',
  'Status',
  'Priority',
  'DueDate',
]

export function fieldByName(module, name) {
  return module?.fields?.find((field) => field.name === name)
}

export function canEditField(module, name) {
  const field = fieldByName(module, name)
  return Boolean(field?.canReadRecordValue && field.canUpdateRecordValue)
}

export function recordValue(record, name) {
  return record?.values?.find((value) => value.name === name)?.value || ''
}

export function selectOptions(module, name) {
  return (fieldByName(module, name)?.options?.options || []).map((option) =>
    typeof option === 'string'
      ? { value: option, text: option }
      : {
          value: String(option.value),
          text: option.text || String(option.value),
        },
  )
}

export function localDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 19)
}

export function ticketForm(module, record) {
  const form = Object.fromEntries(
    TICKET_FIELDS.map((name) => [name, recordValue(record, name)]),
  )
  form.DueDate = localDateTime(form.DueDate)
  if (!record) {
    for (const name of TICKET_FIELDS) {
      const field = fieldByName(module, name)
      const defaultValue = field?.defaultValue?.[0]?.value
      if (defaultValue)
        form[name] =
          name === 'DueDate' ? localDateTime(defaultValue) : defaultValue
    }
    for (const [name, preferred] of [
      ['Status', 'New'],
      ['Priority', 'Medium'],
    ]) {
      const options = selectOptions(module, name)
      form[name] ||=
        options.find((option) => option.value === preferred)?.value ||
        options[0]?.value ||
        ''
    }
  }
  return form
}

export function ticketValues(module, form, record) {
  const original = ticketForm(module, record)
  return TICKET_FIELDS.flatMap((name) => {
    if (
      !canEditField(module, name) ||
      (record && form[name] === original[name])
    )
      return []
    let value = String(form[name] || '')
    if (name === 'Subject') value = value.trim()
    if (name === 'DueDate' && value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime()))
        throw new Error('Enter a valid due date.')
      value = date.toISOString()
    }
    return [{ name, value, place: 0 }]
  })
}

export function errorMessage(cause) {
  if (Array.isArray(cause.details) && cause.details.length) {
    return cause.details
      .map((detail) =>
        [detail.meta?.field, detail.message || detail.kind || 'Invalid value']
          .filter(Boolean)
          .join(': '),
      )
      .join('. ')
  }
  return cause.message || 'Something went wrong. Please try again.'
}

export function createTicketRepository(request) {
  function modulePath(module) {
    return `/compose/namespace/${encodeURIComponent(module.namespaceID)}/module/${encodeURIComponent(module.moduleID)}`
  }
  function recordPath(module, id = '') {
    return `${modulePath(module)}/record/${encodeURIComponent(id)}`
  }
  return {
    async discover() {
      const namespaces = await request('/compose/namespace/', {
        query: { slug: 'plexys-homework' },
      })
      const namespace = namespaces.set?.find(
        (item) => item.slug === 'plexys-homework',
      )
      if (!namespace)
        throw new Error(
          'Plexys Homework is unavailable or you do not have permission to access it.',
        )
      const modules = await request(
        `/compose/namespace/${encodeURIComponent(namespace.namespaceID)}/module/`,
        { query: { handle: 'support-ticket' } },
      )
      const module = modules.set?.find(
        (item) => item.handle === 'support-ticket',
      )
      if (!module)
        throw new Error(
          'Support Ticket is unavailable or you do not have permission to access it.',
        )
      return module
    },
    readModule: (module) => request(modulePath(module)),
    list: (module, pageCursor = '') =>
      request(recordPath(module), {
        query: {
          limit: 25,
          sort: 'createdAt DESC, id DESC',
          incTotal: true,
          pageCursor,
        },
      }),
    read: (module, id) => request(recordPath(module, id)),
    async save(module, form, record) {
      const values = ticketValues(module, form, record)
      if (!record)
        return request(recordPath(module), { method: 'POST', json: { values } })
      if (!values.length) return record
      if (!/^\d+$/.test(record.recordID))
        throw new Error('Invalid ticket identifier.')
      // POST replaces the whole writable value set. PATCH preserves hidden and
      // additional fields, metadata and ownership. Only this ID may be changed.
      return request(recordPath(module), {
        method: 'PATCH',
        json: { values, query: `id = ${record.recordID}` },
      })
    },
    delete: (module, id) =>
      request(recordPath(module, id), { method: 'DELETE' }),
  }
}
