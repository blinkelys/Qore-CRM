<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '../api';
import ContactCompanyLink from './ContactCompanyLink.vue';
import TimelinePanel from './TimelinePanel.vue';
import { useRecordList } from './useRecordList';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  archivedAt: string | null;
  version: number;
}
interface ContactPage {
  contacts: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

const props = defineProps<{
  organizationId: string;
  companiesEnabled?: boolean;
  timelineEnabled?: boolean;
}>();
const base = `/organizations/${props.organizationId}/contacts`;
const { results, search, status, loading, error, load, refresh, applyFilters } =
  useRecordList<ContactPage>(base);
const selected = ref<Contact | null>(null);
const form = reactive({ name: '', email: '', phone: '' });
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

function populate(contact: Contact | null) {
  selected.value = contact;
  form.name = contact?.name ?? '';
  form.email = contact?.email ?? '';
  form.phone = contact?.phone ?? '';
  editing.value = true;
  error.value = '';
  notice.value = '';
}

async function selectContact(id: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await api.get<{ contact: Contact }>(`${base}/${id}`);
    selected.value = response.data.contact;
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
      ? await api.put<{ contact: Contact }>(`${base}/${selected.value.id}`, {
          ...form,
          version: selected.value.version,
        })
      : await api.post<{ contact: Contact }>(base, { ...form });
    selected.value = response.data.contact;
    editing.value = false;
    notice.value = 'Contact saved.';
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
    const response = await api.put<{ contact: Contact }>(
      `${base}/${selected.value.id}/archive`,
      { archived, version: selected.value.version },
    );
    selected.value = response.data.contact;
    notice.value = archived ? 'Contact archived.' : 'Contact restored.';
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
    id="module-contacts"
    class="mt-6 border-t border-slate-800 pt-6"
    aria-labelledby="contacts-heading"
  >
    <h3 id="contacts-heading" class="text-lg font-semibold">Contacts</h3>
    <p class="mt-1 text-sm text-slate-400">
      Search and manage this organization's contacts.
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
      <label class="min-w-52 flex-1 text-sm font-medium">
        Search contacts
        <input
          v-model="search"
          class="field"
          maxlength="100"
          :disabled="loading || busy"
        />
      </label>
      <label class="text-sm font-medium">
        Status
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
        New contact
      </button>
    </form>
    <p v-if="loading" class="mt-4 text-slate-400">Loading contacts...</p>
    <template v-else-if="results">
      <p v-if="!results.contacts.length" class="mt-4 text-sm text-slate-400">
        No contacts found.
      </p>
      <ul v-else class="mt-4 divide-y divide-slate-800">
        <li
          v-for="contact in results.contacts"
          :key="contact.id"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div>
            <p class="font-medium">
              {{ contact.name }}
              <span v-if="contact.archivedAt" class="text-sm text-slate-400"
                >(archived)</span
              >
            </p>
            <p v-if="contact.email" class="text-sm text-slate-400">
              {{ contact.email }}
            </p>
          </div>
          <button
            class="button-secondary text-sm"
            type="button"
            :disabled="busy"
            @click="selectContact(contact.id)"
          >
            View {{ contact.name }}
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
        <span>Page {{ results.page }} · {{ results.total }} contacts</span>
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
      Retry contacts
    </button>
    <div v-if="editing" class="mt-6 border-t border-slate-800 pt-6">
      <h4 class="font-semibold">
        {{ selected ? 'Edit contact' : 'New contact' }}
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
          >Email<input
            v-model="form.email"
            class="field"
            type="email"
            maxlength="254"
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
            Save contact
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
            @click="selectContact(selected.id)"
          >
            Reload contact
          </button>
        </div>
      </form>
    </div>
    <div v-else-if="selected" class="mt-6 border-t border-slate-800 pt-6">
      <h4 class="font-semibold">{{ selected.name }}</h4>
      <dl class="mt-3 space-y-2 text-sm">
        <div>
          <dt class="font-medium text-slate-400">Email</dt>
          <dd class="break-all">{{ selected.email || 'Not set.' }}</dd>
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
          Edit contact
        </button>
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="toggleArchive"
        >
          {{ selected.archivedAt ? 'Restore' : 'Archive' }} contact
        </button>
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="selectContact(selected.id)"
        >
          Reload contact
        </button>
      </div>
      <ContactCompanyLink
        v-if="companiesEnabled"
        :key="selected.id"
        :organization-id="organizationId"
        :contact-id="selected.id"
        :version="selected.version"
        @updated="selected.version = $event"
      />
      <TimelinePanel
        v-if="timelineEnabled"
        :key="selected.id"
        :organization-id="organizationId"
        record-type="contacts"
        :record-id="selected.id"
      />
    </div>
  </section>
</template>
