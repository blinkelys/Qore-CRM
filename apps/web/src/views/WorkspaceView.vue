<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import {
  auth,
  refreshSession,
  type Member,
  type Organization,
  type Role,
} from '../auth';

const router = useRouter();
const organizations = ref<Organization[]>([]);
const members = ref<Member[]>([]);
const selectedId = ref('');
const selected = computed(() =>
  organizations.value.find(
    (organization) => organization.id === selectedId.value,
  ),
);
const loading = ref(true);
const membersLoading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const name = ref('');
const inviteEmail = ref('');
const inviteRole = ref<Role>('member');
let memberRequest = 0;

async function loadMembers() {
  const sequence = ++memberRequest;
  members.value = [];
  if (!selectedId.value) {
    membersLoading.value = false;
    return;
  }
  membersLoading.value = true;
  try {
    const response = await api.get<{ members: Member[] }>(
      `/organizations/${selectedId.value}/members`,
    );
    if (sequence === memberRequest) members.value = response.data.members;
  } catch (cause) {
    if (sequence === memberRequest) error.value = errorMessage(cause);
  } finally {
    if (sequence === memberRequest) membersLoading.value = false;
  }
}

function switchOrganization() {
  inviteRole.value = 'member';
  error.value = '';
  notice.value = '';
  void loadMembers();
}

async function loadOrganizations(preferredId = selectedId.value) {
  const response = await api.get<{ organizations: Organization[] }>(
    '/organizations',
  );
  organizations.value = response.data.organizations;
  selectedId.value = organizations.value.some(
    (organization) => organization.id === preferredId,
  )
    ? preferredId
    : (organizations.value[0]?.id ?? '');
  await loadMembers();
}

onMounted(async () => {
  try {
    await refreshSession();
    if (!auth.user) {
      await router.replace('/login');
      return;
    }
    await loadOrganizations();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
});

async function createOrganization() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await api.post<{ organization: Organization }>(
      '/organizations',
      { name: name.value },
    );
    name.value = '';
    await loadOrganizations(response.data.organization.id);
    notice.value = 'Organization created.';
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function invite() {
  if (!selectedId.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.post(`/organizations/${selectedId.value}/invitations`, {
      email: inviteEmail.value,
      role: inviteRole.value,
    });
    inviteEmail.value = '';
    inviteRole.value = 'member';
    notice.value = 'Invitation sent.';
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function changeRole(member: Member, event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !selectedId.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.patch(`/organizations/${selectedId.value}/members/${member.id}`, {
      role: target.value,
    });
    await loadOrganizations();
    notice.value = 'Role updated.';
  } catch (cause) {
    error.value = errorMessage(cause);
    await loadMembers();
  } finally {
    busy.value = false;
  }
}

async function removeMember(member: Member) {
  if (
    !selectedId.value ||
    !window.confirm(
      member.id === auth.user?.id
        ? 'Leave this organization?'
        : `Remove ${member.email} from this organization?`,
    )
  )
    return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.delete(`/organizations/${selectedId.value}/members/${member.id}`);
    await loadOrganizations();
    notice.value =
      member.id === auth.user?.id
        ? 'You left the organization.'
        : 'Member removed.';
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function logout() {
  busy.value = true;
  error.value = '';
  try {
    await api.post('/auth/logout');
    auth.user = null;
    await router.push('/login');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header class="border-b border-slate-800">
      <div
        class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6"
      >
        <RouterLink to="/" class="text-xl font-bold"
          >Qore<span class="text-teal-400">.</span></RouterLink
        >
        <div v-if="auth.user" class="flex flex-wrap items-center gap-4">
          <span class="text-sm text-slate-400">{{ auth.user.email }}</span>
          <button
            class="button-secondary text-sm"
            type="button"
            :disabled="busy"
            @click="logout"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div>
        <p
          class="text-sm font-semibold tracking-widest text-teal-400 uppercase"
        >
          Your workspace
        </p>
        <h1 class="mt-2 text-3xl font-semibold">Organizations</h1>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p
        v-if="notice"
        class="rounded-lg bg-teal-950 p-3 text-sm text-teal-200"
        role="status"
      >
        {{ notice }}
      </p>
      <p v-if="loading" class="text-slate-400">Loading your workspace...</p>
      <template v-else-if="auth.user">
        <section class="panel">
          <h2 class="text-lg font-semibold">Create an organization</h2>
          <p class="mt-1 text-sm text-slate-400">
            Each organization has its own members and settings.
          </p>
          <form
            class="mt-4 flex flex-wrap items-end gap-3"
            @submit.prevent="createOrganization"
          >
            <label class="min-w-52 flex-1 text-sm font-medium">
              Organization name
              <input v-model="name" class="field" required maxlength="100" />
            </label>
            <button class="button" type="submit" :disabled="busy">
              Create organization
            </button>
          </form>
        </section>
        <section v-if="organizations.length" class="panel">
          <label class="block max-w-sm text-sm font-medium">
            Current organization
            <select
              v-model="selectedId"
              class="field"
              @change="switchOrganization"
            >
              <option
                v-for="organization in organizations"
                :key="organization.id"
                :value="organization.id"
              >
                {{ organization.name }} ({{ organization.role }})
              </option>
            </select>
          </label>
          <div class="mt-8">
            <h2 class="text-lg font-semibold">Members</h2>
            <p v-if="membersLoading" class="mt-4 text-slate-400">
              Loading members...
            </p>
            <ul v-else class="mt-4 divide-y divide-slate-800">
              <li
                v-for="member in members"
                :key="member.id"
                class="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <span class="break-all text-sm"
                  >{{ member.email
                  }}<span
                    v-if="member.id === auth.user.id"
                    class="text-slate-400"
                  >
                    (you)</span
                  ></span
                >
                <div class="flex items-center gap-3">
                  <label v-if="selected?.role === 'owner'" class="text-sm">
                    <span class="sr-only">Role for {{ member.email }}</span>
                    <select
                      class="field mt-0"
                      :value="member.role"
                      :disabled="busy"
                      @change="changeRole(member, $event)"
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </label>
                  <span v-else class="text-sm capitalize text-slate-400">{{
                    member.role
                  }}</span>
                  <button
                    v-if="
                      member.id === auth.user.id ||
                      selected?.role === 'owner' ||
                      (selected?.role === 'admin' && member.role === 'member')
                    "
                    class="button-secondary text-sm"
                    type="button"
                    :disabled="busy"
                    @click="removeMember(member)"
                  >
                    {{ member.id === auth.user.id ? 'Leave' : 'Remove' }}
                  </button>
                </div>
              </li>
            </ul>
          </div>
          <div
            v-if="selected?.role === 'owner' || selected?.role === 'admin'"
            class="mt-8 border-t border-slate-800 pt-6"
          >
            <h2 class="text-lg font-semibold">Invite a member</h2>
            <p class="mt-1 text-sm text-slate-400">
              Invitations expire after seven days.
            </p>
            <form
              class="mt-4 flex flex-wrap items-end gap-3"
              @submit.prevent="invite"
            >
              <label class="min-w-52 flex-1 text-sm font-medium">
                Email address
                <input
                  v-model="inviteEmail"
                  class="field"
                  type="email"
                  required
                  maxlength="254"
                />
              </label>
              <label class="text-sm font-medium">
                Role
                <select v-model="inviteRole" class="field">
                  <option value="member">Member</option>
                  <template v-if="selected.role === 'owner'">
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </template>
                </select>
              </label>
              <button class="button" type="submit" :disabled="busy">
                Send invitation
              </button>
            </form>
          </div>
        </section>
        <p v-else class="text-slate-400">
          Create your first organization to get started.
        </p>
      </template>
    </main>
  </div>
</template>
