<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import { auth, invitationKey, type User } from '../auth';

const props = defineProps<{
  mode: 'login' | 'register' | 'forgot' | 'reset';
}>();
const router = useRouter();
const email = ref('');
const password = ref('');
const token = ref('');
const pending = ref(false);
const error = ref('');
const message = ref('');
const title = computed(
  () =>
    ({
      login: 'Welcome back',
      register: 'Create your account',
      forgot: 'Reset your password',
      reset: 'Choose a new password',
    })[props.mode],
);

onMounted(() => {
  if (props.mode === 'reset') {
    token.value = window.location.hash.slice(1);
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname,
    );
  }
});
watch(
  () => props.mode,
  () => {
    error.value = '';
    message.value = '';
    password.value = '';
  },
);

async function submit() {
  error.value = '';
  message.value = '';
  pending.value = true;
  try {
    if (props.mode === 'forgot') {
      const response = await api.post<{ message: string }>(
        '/auth/forgot-password',
        { email: email.value },
      );
      message.value = response.data.message;
    } else if (props.mode === 'reset') {
      await api.post('/auth/reset-password', {
        token: token.value,
        password: password.value,
      });
      token.value = '';
      message.value = 'Your password has been updated. You can now sign in.';
    } else {
      const response = await api.post<{ user: User }>(`/auth/${props.mode}`, {
        email: email.value,
        password: password.value,
      });
      auth.user = response.data.user;
      await router.push(
        sessionStorage.getItem(invitationKey)
          ? '/accept-invitation'
          : '/workspace',
      );
    }
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
    <div class="mx-auto max-w-md">
      <RouterLink to="/" class="text-xl font-bold"
        >Qore<span class="text-teal-400">.</span></RouterLink
      >
      <main class="panel mt-12">
        <h1 class="text-2xl font-semibold">{{ title }}</h1>
        <p class="mt-2 text-sm text-slate-400">
          {{
            mode === 'register'
              ? 'Start building your workspace.'
              : 'Your workspace, all in one place.'
          }}
        </p>
        <p v-if="error" class="error mt-5" role="alert">{{ error }}</p>
        <p
          v-if="message"
          class="mt-5 rounded-lg bg-teal-950 p-3 text-sm text-teal-200"
          role="status"
        >
          {{ message }}
        </p>
        <p
          v-if="mode === 'reset' && !token && !message"
          class="error mt-5"
          role="alert"
        >
          This reset link is missing. Request a new one.
        </p>
        <form
          v-if="!(mode === 'reset' && (!token || message))"
          class="mt-6 space-y-4"
          @submit.prevent="submit"
        >
          <label v-if="mode !== 'reset'" class="block text-sm font-medium">
            Email
            <input
              v-model="email"
              class="field"
              type="email"
              autocomplete="email"
              required
              maxlength="254"
            />
          </label>
          <label v-if="mode !== 'forgot'" class="block text-sm font-medium">
            Password
            <input
              v-model="password"
              class="field"
              type="password"
              :autocomplete="
                mode === 'login' ? 'current-password' : 'new-password'
              "
              required
              minlength="12"
              maxlength="128"
            />
            <span
              v-if="mode !== 'login'"
              class="mt-1 block text-xs text-slate-400"
              >Use at least 12 characters.</span
            >
          </label>
          <button class="button w-full" type="submit" :disabled="pending">
            {{
              pending
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'register'
                    ? 'Create account'
                    : mode === 'forgot'
                      ? 'Send reset link'
                      : 'Update password'
            }}
          </button>
        </form>
        <div class="mt-6 space-y-2 text-sm text-slate-400">
          <p v-if="mode === 'login'">
            New to Qore?
            <RouterLink class="text-teal-400 hover:underline" to="/register"
              >Create an account</RouterLink
            >
          </p>
          <p v-if="mode === 'login'">
            <RouterLink
              class="text-teal-400 hover:underline"
              to="/forgot-password"
              >Forgot your password?</RouterLink
            >
          </p>
          <p v-if="mode !== 'login'">
            <RouterLink class="text-teal-400 hover:underline" to="/login"
              >Back to sign in</RouterLink
            >
          </p>
        </div>
      </main>
    </div>
  </div>
</template>
