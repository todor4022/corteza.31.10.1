import { ref } from 'vue'
import { createCortezaApi } from '@/lib/api'
import { createTicketRepository, errorMessage } from '@/lib/tickets'

export function useTickets(auth) {
  const apiBase = new URL(window.CortezaAPI || '/api', window.location.origin)
    .pathname
  const repository = createTicketRepository(createCortezaApi({ auth, apiBase }))
  const module = ref(null)
  const records = ref([])
  const loading = ref(false)
  const error = ref('')
  const total = ref(0)
  const nextCursor = ref('')
  const previousCursors = ref([])
  let currentCursor = ''
  let requestVersion = 0

  function reset() {
    requestVersion++
    module.value = null
    records.value = []
    total.value = 0
    nextCursor.value = ''
    previousCursors.value = []
    currentCursor = ''
    error.value = ''
    loading.value = false
  }

  async function load(cursor = '', direction = 'reset') {
    const version = ++requestVersion
    loading.value = true
    error.value = ''
    try {
      let definition = module.value || (await repository.discover())
      definition = await repository.readModule(definition)
      const page = await repository.list(definition, cursor)
      if (version !== requestVersion || auth.status.value !== 'authenticated')
        return
      module.value = definition
      records.value = page.set || []
      total.value = page.filter?.total ?? records.value.length
      nextCursor.value = page.filter?.nextPage || ''
      if (direction === 'next')
        previousCursors.value = [...previousCursors.value, currentCursor]
      else if (direction === 'previous')
        previousCursors.value = previousCursors.value.slice(0, -1)
      else if (direction === 'reset') previousCursors.value = []
      currentCursor = cursor
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause)
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  async function readForEdit(record) {
    const [definition, latest] = await Promise.all([
      repository.readModule(module.value),
      repository.read(module.value, record.recordID),
    ])
    if (!latest.canUpdateRecord)
      throw new Error('You do not have permission to edit this ticket.')
    module.value = definition
    return latest
  }

  return {
    module,
    records,
    loading,
    error,
    total,
    nextCursor,
    previousCursors,
    load,
    reset,
    readForEdit,
    refresh: () => load(currentCursor, 'same'),
    nextPage: () => load(nextCursor.value, 'next'),
    previousPage: () => load(previousCursors.value.at(-1) || '', 'previous'),
    save: (form, record) => repository.save(module.value, form, record),
    remove: (record) => repository.delete(module.value, record.recordID),
  }
}
