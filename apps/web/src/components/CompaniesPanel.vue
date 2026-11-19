<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '../api';
import { useRecordList } from './useRecordList';

interface Company {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  archivedAt: string | null;
  version: number;
}
interface CompanyPage {
  companies: Company[];
  total: number;
  page: number;
  pageSize: number;
}

const props = defineProps<{ organizationId: string }>();
const base = `/organizations/${props.organizationId}/companies`;
const { results, search, status, loading, error, load, refresh, applyFilters } =
  useRecordList<CompanyPage>(base);
const selected = ref<Company | null>(null);
const form = reactive({ name: '', website: '', phone: '' });
const editing = ref(false);
const busy = ref(false);
const notice = ref('');

onMounted(() => refresh());

function filter() {
  applyFilters();
  selected.value = null;
  editing.value = false;
  notice.value = '';
  void refresh();
}

function populate(company: Company | null) {
  selected.value = company;
  form.name = company?.name ?? '';
  form.website = company?.website ?? '';
  form.phone = company?.phone ?? '';
  editing.value = true;
  error.value = '';
  notice.value = '';
}

async function selectCompany(id: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await api.get<{ company: Company }>(`${base}/${id}`);
    selected.value = response.data.company;
    editing.value = false;
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function save() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = selected.value
      ? await api.put<{ company: Company }>(`${base}/${selected.value.id}`, {
          ...form,
          version: selected.value.version,
        })
      : await api.post<{ company: Company }>(base, { ...form });
    selected.value = response.data.company;
    editing.value = false;
    notice.value = 'Company saved.';
    await load(results.value?.page ?? 1);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function toggleArchive() {
  if (!selected.value) return;
  const archived = !selected.value.archivedAt;
  if (archived && !window.confirm(`Archive ${selected.value.name}?`)) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await api.put<{ company: Company }>(
      `${base}/${selected.value.id}/archive`,
      { archived, version: selected.value.version },
    );
    selected.value = response.data.company;
    notice.value = archived ? 'Company archived.' : 'Company restored.';
    await load(results.value?.page ?? 1);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    id="module-companies"
    class="mt-6 border-t border-slate-800 pt-6"
    aria-labelledby="companies-heading"
  >
    <h3 id="companies-heading" class="text-lg font-semibold">Companies</h3>
    <p class="mt-1 text-sm text-slate-400">
      Search and manage this organization's companies.
    </p>
    <p v-if="error" class="error mt-4" role="alert">{{ error }}</p>
    <p
      v-if="notice"
      class="mt-4 rounded-lg bg-teal-950 p-3 text-sm text-teal-200"
      role="status"
    >
      {{ notice }}
    </p>
    <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="filter">
      <label class="min-w-52 flex-1 text-sm font-medium"
        >Search companies
        <input
          v-model="search"
          class="field"
          maxlength="100"
          :disabled="loading || busy"
        />
      </label>
      <label class="text-sm font-medium"
        >Status
        <select v-model="status" class="field" :disabled="loading || busy">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </label>
      <button
        class="button-secondary text-sm"
        type="submit"
        :disabled="loading || busy"
      >
        Search
      </button>
      <button
        class="button text-sm"
        type="button"
        :disabled="loading || busy"
        @click="populate(null)"
      >
        New company
      </button>
    </form>
    <p v-if="loading" class="mt-4 text-slate-400">Loading companies...</p>
    <template v-else-if="results">
      <p v-if="!results.companies.length" class="mt-4 text-sm text-slate-400">
        No companies found.
      </p>
      <ul v-else class="mt-4 divide-y divide-slate-800">
        <li
          v-for="company in results.companies"
          :key="company.id"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <p class="font-medium">
            {{ company.name }}
            <span v-if="company.archivedAt" class="text-sm text-slate-400"
              >(archived)</span
            >
          </p>
          <button
            class="button-secondary text-sm"
            type="button"
            :disabled="busy"
            @click="selectCompany(company.id)"
          >
            View {{ company.name }}
          </button>
        </li>
      </ul>
      <div class="mt-4 flex items-center gap-3 text-sm">
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy || results.page <= 1"
          @click="refresh(results.page - 1)"
        >
          Previous
        </button>
        <span>Page {{ results.page }} · {{ results.total }} companies</span>
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
      v-else-if="error"
      class="button-secondary mt-4 text-sm"
      type="button"
      :disabled="busy"
      @click="refresh()"
    >
      Retry companies
    </button>
    <div v-if="editing" class="mt-6 border-t border-slate-800 pt-6">
      <h4 class="font-semibold">
        {{ selected ? 'Edit company' : 'New company' }}
      </h4>
      <form class="mt-4 space-y-4" @submit.prevent="save">
        <label class="block text-sm font-medium"
          >Name<input
            v-model="form.name"
            class="field"
            required
            maxlength="100"
            :disabled="busy"
        /></label>
        <label class="block text-sm font-medium"
          >Website<input
            v-model="form.website"
            class="field"
            type="url"
            maxlength="2048"
            :disabled="busy"
        /></label>
        <label class="block text-sm font-medium"
          >Phone<input
            v-model="form.phone"
            class="field"
            type="tel"
            maxlength="40"
            :disabled="busy"
        /></label>
        <div class="flex flex-wrap gap-3">
          <button class="button" type="submit" :disabled="busy">
            Save company
          </button>
          <button
            class="button-secondary"
            type="button"
            :disabled="busy"
            @click="editing = false"
          >
            Cancel
          </button>
          <button
            v-if="selected"
            class="button-secondary"
            type="button"
            :disabled="busy"
            @click="selectCompany(selected.id)"
          >
            Reload company
          </button>
        </div>
      </form>
    </div>
    <div v-else-if="selected" class="mt-6 border-t border-slate-800 pt-6">
      <h4 class="font-semibold">{{ selected.name }}</h4>
      <dl class="mt-3 space-y-2 text-sm">
        <div>
          <dt class="font-medium text-slate-400">Website</dt>
          <dd>
            <a
              v-if="selected.website"
              :href="selected.website"
              target="_blank"
              rel="noopener noreferrer"
              class="break-all text-teal-400 hover:underline"
              >{{ selected.website }}</a><span v-else>Not set.</span>
          </dd>
        </div>
        <div>
          <dt class="font-medium text-slate-400">Phone</dt>
          <dd>{{ selected.phone || 'Not set.' }}</dd>
        </div>
        <div>
          <dt class="font-medium text-slate-400">Status</dt>
          <dd>{{ selected.archivedAt ? 'Archived' : 'Active' }}</dd>
        </div>
      </dl>
      <div class="mt-4 flex flex-wrap gap-3">
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="populate(selected)"
        >
          Edit company
        </button>
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="toggleArchive"
        >
          {{ selected.archivedAt ? 'Restore' : 'Archive' }} company
        </button>
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="selectCompany(selected.id)"
        >
          Reload company
        </button>
      </div>
    </div>
  </section>
</template>
