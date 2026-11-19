<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';

type EntryKind = 'note' | 'call' | 'meeting' | 'email' | 'task';
interface Entry {
  id: string;
  kind: EntryKind;
  body: string;
  createdAt: string;
  author: { id: string; email: string };
}
interface EntryPage {
  entries: Entry[];
  total: number;
  page: number;
  pageSize: number;
}

const props = defineProps<{
  organizationId: string;
  recordType: 'contacts' | 'companies';
  recordId: string;
}>();
const base = `/organizations/${props.organizationId}/${props.recordType}/${props.recordId}/timeline`;
const results = ref<EntryPage | null>(null);
const kind = ref<EntryKind>('note');
const body = ref('');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const loadFailed = ref(false);
const retryPage = ref(1);

async function load(page = 1) {
  loading.value = true;
  retryPage.value = page;
  try {
    const response = await api.get<EntryPage>(base, { params: { page } });
    results.value = response.data;
    loadFailed.value = false;
  } catch (cause) {
    loadFailed.value = true;
    throw cause;
  } finally {
    loading.value = false;
  }
}

async function refresh(page = 1) {
  error.value = '';
  try {
    await load(page);
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}
onMounted(() => refresh());

async function addEntry() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.post(base, { kind: kind.value, body: body.value });
    body.value = '';
    kind.value = 'note';
    notice.value = 'Entry added.';
    await load();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    class="mt-5 border-t border-slate-800 pt-5"
    :aria-label="`Notes and activities for this ${recordType === 'contacts' ? 'contact' : 'company'}`"
  >
    <h5 class="font-semibold">Notes and activities</h5>
    <p class="mt-1 text-sm text-slate-400">
      Entries cannot be edited or deleted here and show who added them.
    </p>
    <p v-if="error" class="error mt-3" role="alert">{{ error }}</p>
    <p v-if="notice" class="mt-3 text-sm text-teal-200" role="status">
      {{ notice }}
    </p>
    <form class="mt-4 space-y-3" @submit.prevent="addEntry">
      <label class="block text-sm font-medium"
        >Type
        <select v-model="kind" class="field" :disabled="busy || loading">
          <option value="note">Note</option>
          <option value="call">Call</option>
          <option value="meeting">Meeting</option>
          <option value="email">Email</option>
          <option value="task">Task</option>
        </select>
      </label>
      <label class="block text-sm font-medium"
        >Details
        <textarea
          v-model="body"
          class="field"
          rows="3"
          required
          maxlength="4000"
          :disabled="busy || loading"
        />
      </label>
      <button class="button text-sm" type="submit" :disabled="busy || loading">
        Add entry
      </button>
    </form>
    <p v-if="loading" class="mt-4 text-sm text-slate-400">Loading history...</p>
    <template v-else-if="results">
      <p v-if="!results.entries.length" class="mt-4 text-sm text-slate-400">
        No entries yet.
      </p>
      <ol v-else class="mt-4 divide-y divide-slate-800">
        <li v-for="entry in results.entries" :key="entry.id" class="py-3">
          <p class="text-sm">
            <span class="font-semibold capitalize">{{ entry.kind }}</span> ·
            {{ entry.author.email }} ·
            <time :datetime="entry.createdAt">{{
              new Date(entry.createdAt).toLocaleString()
            }}</time>
          </p>
          <p class="mt-1 whitespace-pre-wrap break-words text-sm">
            {{ entry.body }}
          </p>
        </li>
      </ol>
      <div class="mt-4 flex items-center gap-3 text-sm">
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy || results.page <= 1"
          @click="refresh(results.page - 1)"
        >
          Previous
        </button>
        <span>Page {{ results.page }} · {{ results.total }} entries</span>
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy || results.page * results.pageSize >= results.total"
          @click="refresh(results.page + 1)"
        >
          Next
        </button>
      </div>
    </template>
    <button
      v-if="loadFailed && !loading"
      class="button-secondary mt-3 text-sm"
      type="button"
      :disabled="busy"
      @click="refresh(retryPage)"
    >
      Retry history
    </button>
  </section>
</template>
