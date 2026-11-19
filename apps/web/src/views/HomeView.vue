<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

const status = ref<'checking' | 'online' | 'offline'>('checking');

onMounted(async () => {
  try {
    const response = await api.get<{ status: string }>('/health');
    status.value = response.data.status === 'ok' ? 'online' : 'offline';
  } catch {
    status.value = 'offline';
  }
});
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header
      class="mx-auto flex max-w-6xl items-center justify-between px-6 py-7"
    >
      <span class="text-xl font-bold tracking-tight"
        >Qore<span class="text-teal-400">.</span></span
      >
      <nav class="flex items-center gap-4 text-sm">
        <RouterLink class="text-slate-300 hover:text-white" to="/login"
          >Sign in</RouterLink
        >
        <RouterLink class="button" to="/register">Get started</RouterLink>
      </nav>
    </header>
    <main class="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <p
        class="mb-5 text-sm font-semibold tracking-widest text-teal-400 uppercase"
      >
        A better foundation for your business
      </p>
      <h1 class="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
        Your CRM, built around the way you work.
      </h1>
      <p class="mt-6 max-w-2xl text-lg leading-8 text-slate-400">
        Qore brings your team, customer relationships, and tools together in one
        place. More is coming soon.
      </p>
      <div
        class="mt-12 inline-flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-sm"
        role="status"
        aria-live="polite"
      >
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="status === 'online' ? 'bg-teal-400' : 'bg-amber-400'"
        />
        <span v-if="status === 'checking'">Checking service status...</span>
        <span v-else-if="status === 'online'">Services are online</span>
        <span v-else>Service unavailable. Please try again later.</span>
      </div>
    </main>
  </div>
</template>
