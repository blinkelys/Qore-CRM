<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';

interface Company {
  id: string;
  name: string;
  archivedAt: string | null;
}
interface CompanyPage {
  companies: Company[];
  total: number;
  page: number;
  pageSize: number;
}
const props = defineProps<{
  organizationId: string;
  contactId: string;
  version: number;
}>();
const emit = defineEmits<{ updated: [version: number] }>();
const base = `/organizations/${props.organizationId}`;
const link = `${base}/contacts/${props.contactId}/company`;
const company = ref<Company | null>(null);
const matches = ref<CompanyPage | null>(null);
const search = ref('');
const appliedSearch = ref('');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');

async function loadLink() {
  loading.value = true;
  error.value = '';
  try {
    const response = await api.get<{ company: Company | null }>(link);
    company.value = response.data.company;
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
onMounted(loadLink);

async function findCompanies(page = 1) {
  busy.value = true;
  error.value = '';
  try {
    const response = await api.get<CompanyPage>(`${base}/companies`, {
      params: { q: appliedSearch.value, status: 'active', page },
    });
    matches.value = response.data;
  } catch (cause) {
    matches.value = null;
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
function searchCompanies() {
  appliedSearch.value = search.value;
  notice.value = '';
  void findCompanies();
}

async function setCompany(companyId: string | null) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await api.put<{
      company: Company | null;
      contact: { version: number };
    }>(link, { companyId, version: props.version });
    company.value = response.data.company;
    emit('updated', response.data.contact.version);
    matches.value = null;
    notice.value = companyId ? 'Company linked.' : 'Company link removed.';
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mt-5 border-t border-slate-800 pt-5">
    <h5 class="font-semibold">Company</h5>
    <p v-if="error" class="error mt-3" role="alert">{{ error }}</p>
    <p v-if="notice" class="mt-3 text-sm text-teal-200" role="status">
      {{ notice }}
    </p>
    <p v-if="loading" class="mt-3 text-sm text-slate-400">
      Loading company link...
    </p>
    <template v-else>
      <button
        v-if="error"
        class="button-secondary mt-3 text-sm"
        type="button"
        :disabled="busy"
        @click="loadLink"
      >
        Retry company link
      </button>
      <p v-if="company" class="mt-3 text-sm">
        {{ company.name }}
        <span v-if="company.archivedAt" class="text-slate-400">(archived)</span>
      </p>
      <p v-else-if="!error" class="mt-3 text-sm text-slate-400">
        No company linked.
      </p>
      <button
        v-if="company"
        class="button-secondary mt-3 text-sm"
        type="button"
        :disabled="busy"
        @click="setCompany(null)"
      >
        Remove company link
      </button>
      <form
        class="mt-4 flex flex-wrap items-end gap-3"
        @submit.prevent="searchCompanies"
      >
        <label class="min-w-52 flex-1 text-sm font-medium"
          >Find a company
          <input
            v-model="search"
            class="field"
            maxlength="100"
            :disabled="busy"
          />
        </label>
        <button class="button-secondary text-sm" type="submit" :disabled="busy">
          Find companies
        </button>
      </form>
      <template v-if="matches">
        <p v-if="!matches.companies.length" class="mt-3 text-sm text-slate-400">
          No active companies found.
        </p>
        <ul v-else class="mt-3 divide-y divide-slate-800">
          <li
            v-for="item in matches.companies"
            :key="item.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <span class="text-sm">{{ item.name }}</span>
            <button
              class="button-secondary text-sm"
              type="button"
              :disabled="busy || item.id === company?.id"
              @click="setCompany(item.id)"
            >
              Link {{ item.name }}
            </button>
          </li>
        </ul>
        <div class="mt-3 flex items-center gap-3 text-sm">
          <button
            class="button-secondary text-sm"
            type="button"
            :disabled="busy || matches.page <= 1"
            @click="findCompanies(matches.page - 1)"
          >
            Previous
          </button>
          <span>Page {{ matches.page }} · {{ matches.total }} companies</span>
          <button
            class="button-secondary text-sm"
            type="button"
            :disabled="busy || matches.page * matches.pageSize >= matches.total"
            @click="findCompanies(matches.page + 1)"
          >
            Next
          </button>
        </div>
      </template>
    </template>
  </div>
</template>
