<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '../api';
import { useRecordList } from './useRecordList';

interface Stage {
  id: string;
  name: string;
  archivedAt: string | null;
  version: number;
}
interface Opportunity {
  id: string;
  name: string;
  stageId: string;
  amount: string | null;
  currency: string | null;
  archivedAt: string | null;
  version: number;
}
interface OpportunityPage {
  opportunities: Opportunity[];
  total: number;
  page: number;
  pageSize: number;
}

const props = defineProps<{
  organizationId: string;
  canManageStages: boolean;
}>();
const base = `/organizations/${props.organizationId}/opportunities`;
const stages = ref<Stage[]>([]);
const stagesLoaded = ref(false);
const stagesLoading = ref(false);
const stageError = ref('');
const stageNotice = ref('');
const newStage = ref('');
const editingStage = ref<Stage | null>(null);
const stageName = ref('');
const stageFilter = ref('');
const appliedStageFilter = ref('');
const { results, search, status, loading, error, load, refresh, applyFilters } =
  useRecordList<OpportunityPage>(base, (): Record<string, string> =>
    appliedStageFilter.value ? { stageId: appliedStageFilter.value } : {},
  );
const selected = ref<Opportunity | null>(null);
const editing = ref(false);
const form = reactive({ name: '', stageId: '', amount: '', currency: '' });
const busy = ref(false);
const notice = ref('');
const activeStages = computed(() =>
  stages.value.filter((stage) => !stage.archivedAt),
);

async function loadStages() {
  stagesLoading.value = true;
  try {
    const response = await api.get<{ stages: Stage[] }>(`${base}/stages`);
    stages.value = response.data.stages;
    stagesLoaded.value = true;
  } finally {
    stagesLoading.value = false;
  }
}

async function refreshStages() {
  stageError.value = '';
  try {
    await loadStages();
    editingStage.value = null;
  } catch (cause) {
    stageError.value = errorMessage(cause);
  }
}

onMounted(() => {
  void refreshStages();
  void refresh();
});

async function stageAction(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  stageError.value = '';
  stageNotice.value = '';
  try {
    await action();
    stageNotice.value = message;
    await loadStages();
    if (
      appliedStageFilter.value &&
      !stages.value.some((stage) => stage.id === appliedStageFilter.value)
    ) {
      appliedStageFilter.value = '';
      stageFilter.value = '';
    }
    await load(results.value?.page ?? 1);
    editingStage.value = null;
    newStage.value = '';
  } catch (cause) {
    stageError.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function createStage() {
  return stageAction(
    () => api.post(`${base}/stages`, { name: newStage.value }),
    'Stage added.',
  );
}

function renameStage(stage: Stage) {
  return stageAction(
    () =>
      api.put(`${base}/stages/${stage.id}`, {
        name: stageName.value,
        version: stage.version,
      }),
    'Stage renamed.',
  );
}

function moveStage(stage: Stage, direction: 'up' | 'down') {
  return stageAction(
    () =>
      api.put(`${base}/stages/${stage.id}/move`, {
        direction,
        version: stage.version,
      }),
    'Stage moved.',
  );
}

function toggleStage(stage: Stage) {
  return stageAction(
    () =>
      api.put(`${base}/stages/${stage.id}/archive`, {
        archived: !stage.archivedAt,
        version: stage.version,
      }),
    stage.archivedAt ? 'Stage reactivated.' : 'Stage deactivated.',
  );
}

function deleteStage(stage: Stage) {
  if (!window.confirm(`Delete unused stage ${stage.name}?`)) return;
  void stageAction(
    () =>
      api.delete(`${base}/stages/${stage.id}`, {
        data: { version: stage.version },
      }),
    'Stage deleted.',
  );
}

function filter() {
  applyFilters();
  appliedStageFilter.value = stageFilter.value;
  selected.value = null;
  editing.value = false;
  notice.value = '';
  void refresh();
}

function populate(opportunity: Opportunity | null) {
  selected.value = opportunity;
  form.name = opportunity?.name ?? '';
  form.stageId = opportunity?.stageId ?? activeStages.value[0]?.id ?? '';
  form.amount = opportunity?.amount ?? '';
  form.currency = opportunity?.currency ?? '';
  editing.value = true;
  error.value = '';
  notice.value = '';
}

async function selectOpportunity(id: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await api.get<{ opportunity: Opportunity }>(
      `${base}/${id}`,
    );
    selected.value = response.data.opportunity;
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
      ? await api.put<{ opportunity: Opportunity }>(
          `${base}/${selected.value.id}`,
          {
            ...form,
            version: selected.value.version,
          },
        )
      : await api.post<{ opportunity: Opportunity }>(base, { ...form });
    selected.value = response.data.opportunity;
    editing.value = false;
    notice.value = 'Opportunity saved.';
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
    const response = await api.put<{ opportunity: Opportunity }>(
      `${base}/${selected.value.id}/archive`,
      { archived, version: selected.value.version },
    );
    selected.value = response.data.opportunity;
    notice.value = archived ? 'Opportunity archived.' : 'Opportunity restored.';
    await load(results.value?.page ?? 1);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function stageLabel(id: string) {
  const stage = stages.value.find((item) => item.id === id);
  return stage
    ? `${stage.name}${stage.archivedAt ? ' (inactive)' : ''}`
    : 'Unknown stage';
}
</script>

<template>
  <section
    id="module-opportunities"
    class="mt-6 border-t border-slate-800 pt-6"
    aria-labelledby="opportunities-heading"
  >
    <h3 id="opportunities-heading" class="text-lg font-semibold">
      Opportunities
    </h3>
    <p class="mt-1 text-sm text-slate-400">
      Manage opportunities in your organization's pipeline.
    </p>

    <section class="mt-5" aria-labelledby="stages-heading">
      <h4 id="stages-heading" class="font-semibold">Pipeline stages</h4>
      <p v-if="stageError" class="error mt-4" role="alert">{{ stageError }}</p>
      <p v-if="stageNotice" class="mt-4 text-sm text-teal-200" role="status">
        {{ stageNotice }}
      </p>
      <p v-if="stagesLoading" class="mt-3 text-sm text-slate-400">
        Loading stages...
      </p>
      <template v-else-if="stagesLoaded">
        <p v-if="!stages.length" class="mt-3 text-sm text-slate-400">
          No stages yet. An owner or admin must add a stage before opportunities
          can be created.
        </p>
        <ol v-else class="mt-3 divide-y divide-slate-800">
          <li
            v-for="(stage, index) in stages"
            :key="stage.id"
            class="flex flex-wrap items-center gap-2 py-3"
          >
            <form
              v-if="editingStage?.id === stage.id"
              class="flex flex-wrap items-end gap-2"
              @submit.prevent="renameStage(stage)"
            >
              <label class="text-sm"
                >Stage name<input
                  v-model="stageName"
                  class="field"
                  required
                  maxlength="100"
                  :disabled="busy"
              /></label>
              <button class="button text-sm" :disabled="busy" type="submit">
                Save stage
              </button>
              <button
                class="button-secondary text-sm"
                :disabled="busy"
                type="button"
                @click="editingStage = null"
              >
                Cancel
              </button>
            </form>
            <template v-else>
              <span class="mr-auto"
                >{{ stage.name
                }}<span v-if="stage.archivedAt" class="text-sm text-slate-400">
                  (inactive)</span
                ></span
              >
              <template v-if="canManageStages">
                <button
                  class="button-secondary text-sm"
                  type="button"
                  :disabled="busy || index === 0"
                  :aria-label="`Move ${stage.name} up`"
                  @click="moveStage(stage, 'up')"
                >
                  Up
                </button>
                <button
                  class="button-secondary text-sm"
                  type="button"
                  :disabled="busy || index === stages.length - 1"
                  :aria-label="`Move ${stage.name} down`"
                  @click="moveStage(stage, 'down')"
                >
                  Down
                </button>
                <button
                  class="button-secondary text-sm"
                  type="button"
                  :disabled="busy"
                  @click="
                    editingStage = stage;
                    stageName = stage.name;
                  "
                >
                  Rename {{ stage.name }}
                </button>
                <button
                  class="button-secondary text-sm"
                  type="button"
                  :disabled="busy"
                  @click="toggleStage(stage)"
                >
                  {{ stage.archivedAt ? 'Reactivate' : 'Deactivate' }}
                  {{ stage.name }}
                </button>
                <button
                  class="button-secondary text-sm"
                  type="button"
                  :disabled="busy"
                  @click="deleteStage(stage)"
                >
                  Delete {{ stage.name }}
                </button>
              </template>
            </template>
          </li>
        </ol>
        <form
          v-if="canManageStages"
          class="mt-3 flex flex-wrap items-end gap-3"
          @submit.prevent="createStage"
        >
          <label class="text-sm font-medium"
            >New stage name<input
              v-model="newStage"
              class="field"
              required
              maxlength="100"
              :disabled="busy"
          /></label>
          <button
            class="button-secondary text-sm"
            type="submit"
            :disabled="busy"
          >
            Add stage
          </button>
        </form>
      </template>
      <button
        v-if="stageError"
        class="button-secondary mt-3 text-sm"
        type="button"
        :disabled="busy || stagesLoading"
        @click="refreshStages"
      >
        Reload stages
      </button>
      <p
        v-if="stagesLoaded && !activeStages.length"
        class="mt-3 text-sm text-slate-400"
      >
        An active stage is required to create an opportunity.
      </p>
    </section>

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
        >Search opportunities<input
          v-model="search"
          class="field"
          maxlength="100"
          :disabled="loading || busy"
      /></label>
      <label class="text-sm font-medium"
        >Status<select
          v-model="status"
          class="field"
          :disabled="loading || busy"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select></label
      >
      <label class="text-sm font-medium"
        >Filter by stage<select
          v-model="stageFilter"
          class="field"
          :disabled="loading || busy || !stagesLoaded"
        >
          <option value="">All stages</option>
          <option v-for="stage in stages" :key="stage.id" :value="stage.id">
            {{ stageLabel(stage.id) }}
          </option>
        </select></label
      >
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
        :disabled="loading || busy || !stagesLoaded || !activeStages.length"
        @click="populate(null)"
      >
        New opportunity
      </button>
    </form>
    <p v-if="loading" class="mt-4 text-slate-400">Loading opportunities...</p>
    <template v-else-if="results">
      <p
        v-if="!results.opportunities.length"
        class="mt-4 text-sm text-slate-400"
      >
        No opportunities found.
      </p>
      <ul v-else class="mt-4 divide-y divide-slate-800">
        <li
          v-for="opportunity in results.opportunities"
          :key="opportunity.id"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <p class="font-medium">
            {{ opportunity.name }}
            <span class="text-sm text-slate-400"
              >· {{ stageLabel(opportunity.stageId)
              }}<span v-if="opportunity.archivedAt"> · archived</span></span
            >
          </p>
          <button
            class="button-secondary text-sm"
            type="button"
            :disabled="busy"
            @click="selectOpportunity(opportunity.id)"
          >
            View {{ opportunity.name }}
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
        <span>Page {{ results.page }} · {{ results.total }} opportunities</span>
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
      Retry opportunities
    </button>

    <div v-if="editing" class="mt-6 border-t border-slate-800 pt-6">
      <h4 class="font-semibold">
        {{ selected ? 'Edit opportunity' : 'New opportunity' }}
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
          >Stage<select
            v-model="form.stageId"
            class="field"
            required
            :disabled="busy"
          >
            <option
              v-for="stage in stages.filter(
                (item) => !item.archivedAt || item.id === selected?.stageId,
              )"
              :key="stage.id"
              :value="stage.id"
            >
              {{ stageLabel(stage.id) }}
            </option>
          </select></label
        >
        <label class="block text-sm font-medium"
          >Amount (optional)<input
            v-model="form.amount"
            class="field"
            inputmode="decimal"
            pattern="(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?"
            :disabled="busy"
        /></label>
        <label class="block text-sm font-medium"
          >Currency (three-letter code, required with amount)<input
            v-model="form.currency"
            class="field"
            maxlength="3"
            pattern="[A-Za-z]{3}"
            :disabled="busy"
        /></label>
        <div class="flex flex-wrap gap-3">
          <button class="button" type="submit" :disabled="busy">
            Save opportunity</button
          ><button
            class="button-secondary"
            type="button"
            :disabled="busy"
            @click="editing = false"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
    <div v-else-if="selected" class="mt-6 border-t border-slate-800 pt-6">
      <h4 class="font-semibold">
        {{ selected.name
        }}<span v-if="selected.archivedAt" class="text-sm text-slate-400">
          (archived)</span
        >
      </h4>
      <p class="mt-2 text-sm">Stage: {{ stageLabel(selected.stageId) }}</p>
      <p class="mt-1 text-sm">
        Value:
        {{
          selected.amount !== null
            ? `${selected.amount} ${selected.currency}`
            : 'Not set'
        }}
      </p>
      <div class="mt-4 flex flex-wrap gap-3">
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="populate(selected)"
        >
          Edit opportunity
        </button>
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="toggleArchive"
        >
          {{ selected.archivedAt ? 'Restore' : 'Archive' }} opportunity
        </button>
        <button
          class="button-secondary text-sm"
          type="button"
          :disabled="busy"
          @click="selectOpportunity(selected.id)"
        >
          Reload opportunity
        </button>
      </div>
    </div>
    <button
      v-if="editing && selected"
      class="button-secondary mt-3 text-sm"
      type="button"
      :disabled="busy"
      @click="selectOpportunity(selected.id)"
    >
      Reload opportunity
    </button>
  </section>
</template>
