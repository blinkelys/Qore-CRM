<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import { auth, invitationKey, refreshSession } from '../auth';

const router = useRouter();
const token = ref('');
const loading = ref(true);
const pending = ref(false);
const error = ref('');

onMounted(async () => {
  const fragment = window.location.hash.slice(1);
  if (fragment) {
    sessionStorage.setItem(invitationKey, fragment);
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname,
    );
  }
  token.value = sessionStorage.getItem(invitationKey) ?? '';
  try {
    await refreshSession();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
});

async function accept() {
  pending.value = true;
  error.value = '';
  try {
    await api.post('/invitations/accept', { token: token.value });
    sessionStorage.removeItem(invitationKey);
    await router.push('/workspace');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    pending.value = false;
  }
}

async function switchAccount() {
  error.value = '';
  try {
    await api.post('/auth/logout');
    auth.user = null;
    await router.push('/login');
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

function cancel() {
  sessionStorage.removeItem(invitationKey);
  void router.push('/');
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
    <main class="panel mx-auto mt-12 max-w-md">
      <h1 class="text-2xl font-semibold">Organization invitation</h1>
      <p v-if="error" class="error mt-5" role="alert">{{ error }}</p>
      <p v-if="loading" class="mt-5 text-slate-400">Checking your session...</p>
      <template v-else-if="!token">
        <p class="mt-5 text-slate-300">
          This invitation link is missing. Ask for a new invitation.
        </p>
        <RouterLink class="button-secondary mt-5" to="/">Go home</RouterLink>
      </template>
      <template v-else-if="!auth.user">
        <p class="mt-5 text-slate-300">
          Sign in or create an account using the email address that received
          this invitation.
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <RouterLink class="button" to="/login">Sign in</RouterLink>
          <RouterLink class="button-secondary" to="/register"
            >Create account</RouterLink
          >
          <button class="button-secondary" type="button" @click="cancel">
            Cancel
          </button>
        </div>
      </template>
      <template v-else>
        <p class="mt-5 text-slate-300">
          Signed in as {{ auth.user.email }}. Accept the invitation to join this
          organization.
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <button
            class="button"
            type="button"
            :disabled="pending"
            @click="accept"
          >
            {{ pending ? 'Joining...' : 'Accept invitation' }}
          </button>
          <button class="button-secondary" type="button" @click="switchAccount">
            Switch account
          </button>
          <button class="button-secondary" type="button" @click="cancel">
            Cancel
          </button>
        </div>
      </template>
    </main>
  </div>
</template>
