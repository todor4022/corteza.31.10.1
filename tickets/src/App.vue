<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Inbox,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
} from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import TicketFormDialog from '@/components/TicketFormDialog.vue'
import { useCortezaAuth } from '@/composables/useCortezaAuth'
import { useTickets } from '@/composables/useTickets'
import {
  canEditField,
  errorMessage,
  fieldByName,
  recordValue,
} from '@/lib/tickets'

const auth = useCortezaAuth()
const { user, status, error: authError } = auth
const tickets = useTickets(auth)
const { module, records, loading, error, total, nextCursor, previousCursors } =
  tickets
const formOpen = ref(false)
const editing = ref(null)
const saving = ref(false)
const formError = ref('')
const openingId = ref('')
const deletingRecord = ref(null)
const deleting = ref(false)
const deleteError = ref('')
const notice = ref('')
const busy = computed(
  () => saving.value || deleting.value || Boolean(openingId.value),
)
const canCreate = computed(
  () =>
    module.value?.canCreateRecord &&
    ['Subject', 'Description', 'Status', 'Priority', 'DueDate'].some((name) =>
      canEditField(module.value, name),
    ),
)
const displayName = computed(
  () =>
    user.value?.name ||
    user.value?.email ||
    user.value?.handle ||
    'Corteza user',
)
const initials = computed(() =>
  displayName.value
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase(),
)
const statusClasses = {
  New: 'border-blue-200 bg-blue-50 text-blue-700',
  'In Progress': 'border-amber-200 bg-amber-50 text-amber-800',
  Resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Closed: 'border-slate-200 bg-slate-100 text-slate-600',
}
const priorityClasses = {
  Low: 'bg-slate-400',
  Medium: 'bg-blue-500',
  High: 'bg-orange-500',
  Urgent: 'bg-red-500',
}
const readable = (name) =>
  Boolean(fieldByName(module.value, name)?.canReadRecordValue)
const subject = (record) =>
  readable('Subject')
    ? recordValue(record, 'Subject') || 'Untitled ticket'
    : 'Restricted subject'
const dateLabel = (value) =>
  value && !Number.isNaN(new Date(value).getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'No due date'

watch(
  status,
  (value) => {
    if (value === 'authenticated') tickets.load()
    else {
      tickets.reset()
      formOpen.value = false
      deletingRecord.value = null
      notice.value = ''
    }
  },
  { immediate: true },
)
onMounted(() => auth.initialize())

function createTicket() {
  editing.value = null
  formError.value = ''
  notice.value = ''
  formOpen.value = true
}

async function editTicket(record) {
  openingId.value = record.recordID
  error.value = ''
  notice.value = ''
  try {
    const latest = await tickets.readForEdit(record)
    if (status.value !== 'authenticated') return
    editing.value = latest
    formError.value = ''
    formOpen.value = true
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    openingId.value = ''
  }
}

async function saveTicket(form) {
  if (saving.value) return
  saving.value = true
  formError.value = ''
  try {
    await tickets.save(form, editing.value)
    formOpen.value = false
    notice.value = editing.value ? 'Ticket updated.' : 'Ticket created.'
    await tickets.load()
  } catch (cause) {
    formError.value = errorMessage(cause)
  } finally {
    saving.value = false
  }
}

function askDelete(record) {
  deletingRecord.value = record
  deleteError.value = ''
  notice.value = ''
}

async function deleteTicket() {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await tickets.remove(deletingRecord.value)
    deletingRecord.value = null
    notice.value = 'Ticket deleted.'
    await tickets.load()
  } catch (cause) {
    deleteError.value = errorMessage(cause)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b bg-white">
      <div
        class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8"
      >
        <a
          href="/"
          class="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <span
            class="flex size-9 items-center justify-center rounded-xl bg-primary text-white"
            ><Ticket class="size-5" aria-hidden="true"
          /></span>
          <span class="text-sm font-semibold tracking-tight"
            >Plexys Homework<span
              class="mt-0.5 block text-xs font-normal text-muted-foreground"
              >Support desk</span
            ></span
          >
        </a>
        <div
          v-if="status === 'authenticated'"
          class="flex min-w-0 items-center gap-3"
        >
          <span
            class="hidden size-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 sm:flex"
            aria-hidden="true"
            >{{ initials }}</span
          >
          <div class="hidden min-w-0 text-right sm:block">
            <p class="max-w-56 truncate text-sm font-medium">
              {{ displayName }}
            </p>
            <p
              v-if="user.email && user.email !== displayName"
              class="max-w-56 truncate text-xs text-muted-foreground"
            >
              {{ user.email }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              Signed in with Corteza
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click="auth.logout"
            ><LogOut class="size-4" aria-hidden="true" /><span
              >Sign out</span
            ></Button
          >
        </div>
      </div>
    </header>

    <main
      v-if="status !== 'authenticated'"
      class="mx-auto flex max-w-lg flex-col items-center px-6 py-28 text-center"
    >
      <span
        class="mb-6 flex size-14 items-center justify-center rounded-2xl border bg-white text-primary"
        ><Ticket class="size-7" aria-hidden="true"
      /></span>
      <h1 class="text-2xl font-semibold tracking-tight">Support tickets</h1>
      <template v-if="status === 'loading' || status === 'redirecting'">
        <p class="mt-3 text-sm text-muted-foreground">
          Connecting to your Corteza account…
        </p>
        <LoaderCircle
          class="mt-6 size-5 animate-spin text-muted-foreground"
          aria-label="Signing in"
        />
      </template>
      <template v-else>
        <p
          class="mt-3 text-sm leading-6 text-muted-foreground"
          :role="authError ? 'alert' : undefined"
        >
          {{
            authError ||
            'Sign in with your Corteza account to manage support requests.'
          }}
        </p>
        <Button class="mt-6" @click="auth.login">Continue with Corteza</Button>
      </template>
    </main>

    <main v-else class="mx-auto max-w-6xl px-5 py-9 sm:px-8 sm:py-12">
      <a
        href="/"
        class="mb-7 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        ><ArrowLeft class="size-3.5" aria-hidden="true" />Back to Corteza</a
      >
      <div class="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div class="mb-2 flex items-center gap-3">
            <h1 class="text-3xl font-semibold tracking-tight">
              Support tickets
            </h1>
            <Badge v-if="module" variant="secondary" class="rounded-full">{{
              total
            }}</Badge>
          </div>
          <p class="text-sm leading-6 text-muted-foreground">
            Track requests and keep your team moving.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            :disabled="loading || busy"
            @click="tickets.refresh"
            ><RefreshCw
              class="size-4"
              :class="{ 'animate-spin': loading }"
              aria-hidden="true"
            />Refresh</Button
          >
          <Button
            v-if="canCreate"
            :disabled="busy || loading"
            @click="createTicket"
            ><Plus class="size-4" aria-hidden="true" />New ticket</Button
          >
        </div>
      </div>

      <div
        v-if="notice"
        role="status"
        class="mb-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        <CircleCheck class="size-4 shrink-0" aria-hidden="true" />{{ notice }}
      </div>
      <div
        v-if="error"
        role="alert"
        class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        <p>{{ error }}</p>
        <Button
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="tickets.refresh"
          >Try again</Button
        >
      </div>

      <section
        aria-label="Support tickets"
        :aria-busy="loading"
        class="overflow-hidden rounded-xl border bg-white shadow-xs"
      >
        <div class="flex items-center justify-between border-b px-5 py-4">
          <h2 class="text-sm font-semibold">All tickets</h2>
          <span class="text-xs text-muted-foreground">{{
            loading ? 'Updating…' : 'Newest first'
          }}</span>
        </div>
        <div
          v-if="loading && !records.length"
          role="status"
          class="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground"
        >
          <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Loading
          tickets…
        </div>
        <div
          v-else-if="!records.length"
          class="flex flex-col items-center px-6 py-16 text-center"
        >
          <span
            class="mb-4 flex size-12 items-center justify-center rounded-xl bg-slate-50 text-slate-400"
            ><Inbox class="size-6" aria-hidden="true"
          /></span>
          <h3 class="text-sm font-semibold">
            {{ error ? 'Tickets could not be loaded' : 'No tickets yet' }}
          </h3>
          <p class="mt-2 max-w-sm text-sm text-muted-foreground">
            {{
              error
                ? 'Check your access and try again.'
                : canCreate
                  ? 'Create your first ticket to get started.'
                  : 'There are no support tickets available to your account.'
            }}
          </p>
          <Button
            v-if="canCreate && !error"
            variant="outline"
            class="mt-5"
            @click="createTicket"
            ><Plus class="size-4" aria-hidden="true" />New ticket</Button
          >
        </div>
        <Table v-else>
          <TableHeader
            ><TableRow class="bg-slate-50/70 hover:bg-slate-50/70"
              ><TableHead class="w-[43%] pl-5">Subject</TableHead
              ><TableHead>Status</TableHead><TableHead>Priority</TableHead
              ><TableHead>Due date</TableHead
              ><TableHead class="pr-5 text-right">Actions</TableHead></TableRow
            ></TableHeader
          >
          <TableBody>
            <TableRow v-for="record in records" :key="record.recordID">
              <TableCell class="max-w-xs py-5 pl-5 align-top sm:max-w-sm">
                <p class="truncate font-medium" :title="subject(record)">
                  {{ subject(record) }}
                </p>
                <p
                  v-if="
                    readable('Description') &&
                    recordValue(record, 'Description')
                  "
                  class="mt-1 line-clamp-2 whitespace-normal text-xs leading-5 text-muted-foreground"
                >
                  {{ recordValue(record, 'Description') }}
                </p>
              </TableCell>
              <TableCell class="align-top pt-5"
                ><Badge
                  v-if="readable('Status')"
                  variant="outline"
                  :class="statusClasses[recordValue(record, 'Status')]"
                  >{{ recordValue(record, 'Status') || 'Not set' }}</Badge
                ><span v-else class="text-xs text-muted-foreground"
                  >Restricted</span
                ></TableCell
              >
              <TableCell class="align-top pt-5"
                ><span
                  v-if="readable('Priority')"
                  class="inline-flex items-center gap-2 text-xs"
                  ><span
                    class="size-1.5 rounded-full"
                    :class="
                      priorityClasses[recordValue(record, 'Priority')] ||
                      'bg-slate-300'
                    "
                    aria-hidden="true"
                  />{{ recordValue(record, 'Priority') || 'Not set' }}</span
                ><span v-else class="text-xs text-muted-foreground"
                  >Restricted</span
                ></TableCell
              >
              <TableCell class="align-top pt-5 text-xs text-muted-foreground">{{
                readable('DueDate')
                  ? dateLabel(recordValue(record, 'DueDate'))
                  : 'Restricted'
              }}</TableCell>
              <TableCell class="pr-5 align-top pt-4 text-right">
                <div
                  v-if="record.canUpdateRecord || record.canDeleteRecord"
                  class="flex justify-end gap-1"
                >
                  <Button
                    v-if="record.canUpdateRecord"
                    variant="ghost"
                    size="icon-sm"
                    :disabled="busy || loading"
                    :aria-label="`Edit ${subject(record)}`"
                    @click="editTicket(record)"
                    ><LoaderCircle
                      v-if="openingId === record.recordID"
                      class="size-4 animate-spin"
                      aria-hidden="true" /><Pencil
                      v-else
                      class="size-4"
                      aria-hidden="true"
                  /></Button>
                  <Button
                    v-if="record.canDeleteRecord"
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    :disabled="busy || loading"
                    :aria-label="`Delete ${subject(record)}`"
                    @click="askDelete(record)"
                    ><Trash2 class="size-4" aria-hidden="true"
                  /></Button>
                </div>
                <span v-else class="text-xs text-muted-foreground"
                  >Read only</span
                >
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div
          v-if="module"
          class="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs text-muted-foreground"
        >
          <span
            >{{ records.length }} of {{ total }}
            {{ Number(total) === 1 ? 'ticket' : 'tickets' }}</span
          >
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="!previousCursors.length || loading || busy"
              @click="tickets.previousPage"
              ><ChevronLeft
                class="size-3.5"
                aria-hidden="true"
              />Previous</Button
            ><Button
              variant="outline"
              size="sm"
              :disabled="!nextCursor || loading || busy"
              @click="tickets.nextPage"
              >Next<ChevronRight class="size-3.5" aria-hidden="true"
            /></Button>
          </div>
        </div>
      </section>

      <TicketFormDialog
        v-model:open="formOpen"
        :module="module"
        :record="editing"
        :saving="saving"
        :error="formError"
        @save="saveTicket"
      />
      <AlertDialog
        :open="Boolean(deletingRecord)"
        @update:open="
          (open) => {
            if (!open && !deleting) deletingRecord = null
          }
        "
      >
        <AlertDialogContent
          @escape-key-down="(event) => deleting && event.preventDefault()"
        >
          <AlertDialogHeader
            ><AlertDialogTitle>Delete ticket?</AlertDialogTitle
            ><AlertDialogDescription
              >“{{ deletingRecord ? subject(deletingRecord) : '' }}” will be
              removed from the ticket list.</AlertDialogDescription
            ></AlertDialogHeader
          >
          <p
            v-if="deleteError"
            role="alert"
            class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {{ deleteError }}
          </p>
          <AlertDialogFooter
            ><AlertDialogCancel :disabled="deleting">Cancel</AlertDialogCancel
            ><Button
              variant="destructive"
              :disabled="deleting"
              @click="deleteTicket"
              ><LoaderCircle
                v-if="deleting"
                class="size-4 animate-spin"
                aria-hidden="true"
              />{{ deleting ? 'Deleting…' : 'Delete ticket' }}</Button
            ></AlertDialogFooter
          >
        </AlertDialogContent>
      </AlertDialog>
    </main>
  </div>
</template>
