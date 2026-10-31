<script setup>
import { computed, reactive, watch } from 'vue'
import { LoaderCircle } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  canEditField,
  fieldByName,
  selectOptions,
  ticketForm,
} from '@/lib/tickets'

const props = defineProps({
  open: Boolean,
  module: Object,
  record: Object,
  saving: Boolean,
  error: String,
})
const emit = defineEmits(['update:open', 'save'])
const form = reactive({})
const editing = computed(() => Boolean(props.record))
const fields = computed(
  () =>
    props.module?.fields?.filter(
      (field) =>
        ['Subject', 'Description', 'Status', 'Priority', 'DueDate'].includes(
          field.name,
        ) && field.canReadRecordValue,
    ) || [],
)
const hasEditableFields = computed(() =>
  fields.value.some((field) => canEditField(props.module, field.name)),
)
const editable = (name) => !props.saving && canEditField(props.module, name)
const required = (name) =>
  Boolean(fieldByName(props.module, name)?.isRequired && editable(name))
const options = (name) => {
  const items = selectOptions(props.module, name)
  if (form[name] && !items.some((item) => item.value === form[name]))
    items.push({ value: form[name], text: form[name] })
  return items
}

watch(
  () => [props.open, props.record],
  () => {
    if (props.open) Object.assign(form, ticketForm(props.module, props.record))
  },
  { immediate: true },
)

function setOpen(open) {
  if (!props.saving) emit('update:open', open)
}

function submit() {
  if (!props.saving && hasEditableFields.value) emit('save', { ...form })
}
</script>

<template>
  <Dialog :open="open" @update:open="setOpen">
    <DialogContent
      class="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
      :show-close-button="!saving"
      @interact-outside="(event) => saving && event.preventDefault()"
      @escape-key-down="(event) => saving && event.preventDefault()"
    >
      <DialogHeader>
        <DialogTitle>{{ editing ? 'Edit ticket' : 'New ticket' }}</DialogTitle>
        <DialogDescription>{{
          editing
            ? 'Update the details of this support request.'
            : 'Add a support request for your team to track.'
        }}</DialogDescription>
      </DialogHeader>

      <form id="ticket-form" class="grid gap-5 py-2" @submit.prevent="submit">
        <div
          v-if="error"
          role="alert"
          class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {{ error }}
        </div>
        <template v-for="field in fields" :key="field.name">
          <div class="grid gap-2">
            <Label :for="`ticket-${field.name}`">
              {{ field.label || field.name }}
              <span
                v-if="required(field.name)"
                class="text-muted-foreground"
                aria-hidden="true"
                >*</span
              >
              <span
                v-if="!canEditField(module, field.name)"
                class="text-xs font-normal text-muted-foreground"
                >(read only)</span
              >
            </Label>
            <Textarea
              v-if="field.name === 'Description'"
              :id="`ticket-${field.name}`"
              v-model="form[field.name]"
              :disabled="!editable(field.name)"
              :required="required(field.name)"
              rows="4"
              placeholder="Describe the request and any useful context…"
              class="resize-y"
            />
            <Select
              v-else-if="field.kind === 'Select'"
              v-model="form[field.name]"
              :disabled="!editable(field.name)"
              :required="required(field.name)"
            >
              <SelectTrigger
                :id="`ticket-${field.name}`"
                class="w-full"
                :aria-label="field.label || field.name"
                ><SelectValue
                  :placeholder="`Choose ${field.label || field.name}`"
              /></SelectTrigger>
              <SelectContent
                ><SelectItem
                  v-for="option in options(field.name)"
                  :key="option.value"
                  :value="option.value"
                  >{{ option.text }}</SelectItem
                ></SelectContent
              >
            </Select>
            <Input
              v-else
              :id="`ticket-${field.name}`"
              v-model="form[field.name]"
              :type="field.name === 'DueDate' ? 'datetime-local' : 'text'"
              :step="field.name === 'DueDate' ? 1 : undefined"
              :disabled="!editable(field.name)"
              :required="required(field.name)"
              :placeholder="
                field.name === 'Subject'
                  ? 'A short summary of the request'
                  : undefined
              "
              :autofocus="field.name === 'Subject'"
            />
            <p
              v-if="field.name === 'DueDate'"
              class="text-xs text-muted-foreground"
            >
              Shown in your local time zone.
            </p>
          </div>
        </template>
        <p v-if="!hasEditableFields" class="text-sm text-muted-foreground">
          You do not have permission to change these ticket fields.
        </p>
      </form>

      <DialogFooter class="border-t pt-4">
        <Button
          type="button"
          variant="outline"
          :disabled="saving"
          @click="setOpen(false)"
          >Cancel</Button
        >
        <Button
          type="submit"
          form="ticket-form"
          :disabled="saving || !hasEditableFields"
        >
          <LoaderCircle
            v-if="saving"
            class="size-4 animate-spin"
            aria-hidden="true"
          />
          {{ saving ? 'Saving…' : editing ? 'Save changes' : 'Create ticket' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
