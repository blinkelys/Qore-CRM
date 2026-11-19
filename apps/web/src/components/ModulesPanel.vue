<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';
import type { Role } from '../auth';
import ContactsPanel from './ContactsPanel.vue';

interface ModuleSummary {
  key: string;
  name: string;
  description: string;
  version: number;
  dependencies: string[];
  permissions: { read: Role[]; manage: Role[] };
  navigation: { label: string; anchor: string };
  status: 'available' | 'enabled' | 'unavailable';
  entitled: boolean;
  enabled: boolean;
}

interface ProfileSettings {
  description: string;
  website: string;
}

const props = defineProps<{ organizationId: string; role: Role }>();
const modules = ref<ModuleSummary[]>([]);
const profile = ref<ProfileSettings | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const profileModule = computed(() =>
  modules.value.find((module) => module.key === 'organization-profile'),
);
const contactsModule = computed(() =>
  modules.value.find((module) => module.key === 'contacts'),
);
const canManageProfile = computed(
  () => profileModule.value?.permissions.manage.includes(props.role) ?? false,
);

async function load() {
  loading.value = true;
  profile.value = null;
  try {
    const response = await api.get<{ modules: ModuleSummary[] }>(
      `/organizations/${props.organizationId}/modules`,
    );
    modules.value = response.data.modules;
    if (profileModule.value?.status === 'enabled') {
      const settings = await api.get<{ settings: ProfileSettings }>(
        `/organizations/${props.organizationId}/modules/organization-profile/settings`,
      );
      profile.value = settings.data.settings;
    }
  } finally {
    loading.value = false;
  }
}

async function refresh() {
  error.value = '';
  try {
    await load();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

onMounted(refresh);

async function toggle(module: ModuleSummary) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.put(
      `/organizations/${props.organizationId}/modules/${module.key}/enabled`,
      { enabled: !module.enabled },
    );
    await load();
    notice.value = `${module.name} ${module.enabled ? 'disabled' : 'enabled'}.`;
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function saveProfile() {
  if (!profile.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await api.put<{ settings: ProfileSettings }>(
      `/organizations/${props.organizationId}/modules/organization-profile/settings`,
      profile.value,
    );
    profile.value = response.data.settings;
    notice.value = 'Organization profile saved.';
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="modules-heading">
    <h2 id="modules-heading" class="text-xl font-semibold">Modules</h2>
    <p class="mt-1 text-sm text-slate-400">
      Enable only what this organization needs. Disabled modules retain their
      data.
    </p>
    <p v-if="error" class="error mt-4" role="alert">{{ error }}</p>
    <p
      v-if="notice"
      class="mt-4 rounded-lg bg-teal-950 p-3 text-sm text-teal-200"
      role="status"
    >
      {{ notice }}
    </p>
    <p v-if="loading" class="mt-5 text-slate-400">Loading modules...</p>
    <template v-else>
      <button
        v-if="error"
        class="button-secondary mt-4 text-sm"
        type="button"
        :disabled="busy"
        @click="refresh"
      >
        Retry
      </button>
      <p v-if="!modules.length && !error" class="mt-5 text-slate-400">
        No modules are registered.
      </p>
      <ul class="mt-4 divide-y divide-slate-800">
        <li
          v-for="module in modules"
          :key="module.key"
          class="flex flex-wrap items-center justify-between gap-4 py-4"
        >
          <div>
            <h3 class="font-semibold">{{ module.name }}</h3>
            <p class="mt-1 text-sm text-slate-400">{{ module.description }}</p>
            <p
              class="mt-2 text-sm capitalize"
              :class="
                module.status === 'enabled' ? 'text-teal-400' : 'text-slate-400'
              "
            >
              {{ module.status }}
              <span v-if="module.dependencies.length" class="normal-case">
                · Requires {{ module.dependencies.join(', ') }}</span
              >
            </p>
          </div>
          <div class="flex items-center gap-3">
            <a
              v-if="module.status === 'enabled'"
              class="text-sm text-teal-400 hover:underline"
              :href="module.navigation.anchor"
            >
              {{ module.navigation.label }}
            </a>
            <button
              v-if="
                module.permissions.manage.includes(role) &&
                module.entitled &&
                (module.status !== 'unavailable' || module.enabled)
              "
              class="button-secondary text-sm"
              type="button"
              :disabled="busy"
              @click="toggle(module)"
            >
              {{ module.enabled ? 'Disable' : 'Enable' }} {{ module.name }}
            </button>
          </div>
        </li>
      </ul>
      <section
        v-if="profileModule?.status === 'enabled' && profile"
        id="module-organization-profile"
        class="mt-6 border-t border-slate-800 pt-6"
      >
        <h3 class="text-lg font-semibold">Organization profile</h3>
        <form
          v-if="canManageProfile"
          class="mt-4 space-y-4"
          @submit.prevent="saveProfile"
        >
          <label class="block text-sm font-medium">
            Description
            <textarea
              v-model="profile.description"
              class="field"
              rows="3"
              maxlength="500"
            />
          </label>
          <label class="block text-sm font-medium">
            Website
            <input
              v-model="profile.website"
              class="field"
              type="url"
              maxlength="2048"
              placeholder="https://example.com"
            />
          </label>
          <button class="button" type="submit" :disabled="busy">
            Save profile
          </button>
        </form>
        <dl v-else class="mt-4 space-y-4 text-sm">
          <div>
            <dt class="font-medium text-slate-400">Description</dt>
            <dd class="mt-1 whitespace-pre-wrap">
              {{ profile.description || 'Not set.' }}
            </dd>
          </div>
          <div>
            <dt class="font-medium text-slate-400">Website</dt>
            <dd class="mt-1">
              <a
                v-if="profile.website"
                :href="profile.website"
                target="_blank"
                rel="noopener noreferrer"
                class="break-all text-teal-400 hover:underline"
                >{{ profile.website }}</a
              >
              <span v-else>Not set.</span>
            </dd>
          </div>
        </dl>
      </section>
      <ContactsPanel
        v-if="contactsModule?.status === 'enabled'"
        :organization-id="organizationId"
      />
    </template>
  </section>
</template>
