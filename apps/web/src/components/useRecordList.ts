import { ref, shallowRef } from 'vue';
import { api, errorMessage } from '../api';

export function useRecordList<Page>(
  base: string,
  additionalParams: () => Record<string, string> = () => ({}),
) {
  const results = shallowRef<Page | null>(null);
  const search = ref('');
  const status = ref<'active' | 'archived' | 'all'>('active');
  const appliedSearch = ref('');
  const appliedStatus = ref<'active' | 'archived' | 'all'>('active');
  const loading = ref(false);
  const error = ref('');

  async function load(page = 1) {
    loading.value = true;
    try {
      const response = await api.get<Page>(base, {
        params: {
          q: appliedSearch.value,
          status: appliedStatus.value,
          page,
          ...additionalParams(),
        },
      });
      results.value = response.data;
    } finally {
      loading.value = false;
    }
  }

  async function refresh(page = 1) {
    error.value = '';
    try {
      await load(page);
    } catch (cause) {
      results.value = null;
      error.value = errorMessage(cause);
    }
  }

  function applyFilters() {
    appliedSearch.value = search.value;
    appliedStatus.value = status.value;
  }

  return {
    results,
    search,
    status,
    loading,
    error,
    load,
    refresh,
    applyFilters,
  };
}
