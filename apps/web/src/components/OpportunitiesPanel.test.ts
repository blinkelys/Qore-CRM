import { createApp } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import OpportunitiesPanel from './OpportunitiesPanel.vue';

const base = '/organizations/org-id/opportunities';
const stage = { id: 'stage-id', name: 'New', archivedAt: null, version: 1 };
const opportunity = {
  id: 'deal-id',
  name: 'Deal',
  stageId: stage.id,
  amount: '12.00',
  currency: 'USD',
  archivedAt: null,
  version: 1,
};
const page = (opportunities = [opportunity]) => ({
  opportunities,
  total: opportunities.length,
  page: 1,
  pageSize: 20,
});

function mountPanel(canManageStages: boolean) {
  const container = document.createElement('div');
  const app = createApp(OpportunitiesPanel, {
    organizationId: 'org-id',
    canManageStages,
  });
  app.mount(container);
  return { app, container };
}
function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function setValue(
  element: HTMLInputElement | HTMLSelectElement | null,
  value: string,
) {
  if (!element) throw new Error('Missing input');
  element.value = value;
  element.dispatchEvent(
    new Event(element.tagName === 'SELECT' ? 'change' : 'input'),
  );
}
function submit(form: HTMLFormElement | null) {
  if (!form) throw new Error('Missing form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
afterEach(() => vi.restoreAllMocks());

describe('opportunities workspace', () => {
  it('requires an active stage and allows administrators to add one', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) =>
      url === `${base}/stages`
        ? { data: { stages: post.mock.calls.length ? [stage] : [] } }
        : { data: page([]) },
    );
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { stage } });
    const { app, container } = mountPanel(true);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('No stages yet.'),
    );
    expect(button(container, 'New opportunity').disabled).toBe(true);
    setValue(container.querySelector('input[maxlength="100"]'), 'New');
    submit(container.querySelector('section form'));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Stage added.'),
    );
    expect(post).toHaveBeenCalledWith(`${base}/stages`, { name: 'New' });
    expect(button(container, 'New opportunity').disabled).toBe(false);
    app.unmount();
  });

  it('lets members create and filter opportunities without stage management controls', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (url) =>
        url === `${base}/stages`
          ? { data: { stages: [stage] } }
          : { data: page([]) },
      );
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { opportunity } });
    const { app, container } = mountPanel(false);
    await vi.waitFor(() =>
      expect(button(container, 'New opportunity').disabled).toBe(false),
    );
    expect(container.textContent).not.toContain('Add stage');
    button(container, 'New opportunity').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Save opportunity'),
    );
    const form =
      [...container.querySelectorAll('form')].find((item) =>
        item.textContent?.includes('Save opportunity'),
      ) ?? null;
    setValue(form?.querySelector('input[required]') ?? null, 'Deal');
    setValue(form?.querySelector('input[inputmode=decimal]') ?? null, '12');
    setValue(form?.querySelector('input[maxlength="3"]') ?? null, 'USD');
    submit(form);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Opportunity saved.'),
    );
    expect(post).toHaveBeenCalledWith(base, {
      name: 'Deal',
      stageId: stage.id,
      amount: '12',
      currency: 'USD',
    });
    const filter =
      [...container.querySelectorAll('form')].find((item) =>
        item.textContent?.includes('Filter by stage'),
      ) ?? null;
    setValue(filter?.querySelectorAll('select')[1] ?? null, stage.id);
    submit(filter);
    await vi.waitFor(() =>
      expect(get).toHaveBeenCalledWith(base, {
        params: { q: '', status: 'active', page: 1, stageId: stage.id },
      }),
    );
    app.unmount();
  });

  it('recovers from a conflicting opportunity edit by reloading the record', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === `${base}/stages`) return { data: { stages: [stage] } };
      if (url === `${base}/deal-id`)
        return {
          data: {
            opportunity: { ...opportunity, name: 'Updated', version: 2 },
          },
        };
      return { data: page() };
    });
    vi.spyOn(api, 'put').mockRejectedValue({
      isAxiosError: true,
      response: {
        data: { error: { message: 'Opportunity changed. Reload it.' } },
      },
    });
    const { app, container } = mountPanel(false);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('View Deal'),
    );
    button(container, 'View Deal').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Edit opportunity'),
    );
    button(container, 'Edit opportunity').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Save opportunity'),
    );
    submit(
      [...container.querySelectorAll('form')].find((item) =>
        item.textContent?.includes('Save opportunity'),
      ) ?? null,
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Opportunity changed.'),
    );
    button(container, 'Reload opportunity').click();
    await vi.waitFor(() => expect(container.textContent).toContain('Updated'));
    app.unmount();
  });

  it('allows administrators to reload stages after a conflict', async () => {
    let updated = false;
    vi.spyOn(api, 'get').mockImplementation(async (url) =>
      url === `${base}/stages`
        ? {
            data: {
              stages: [
                {
                  ...stage,
                  name: updated ? 'Updated' : 'New',
                  version: updated ? 2 : 1,
                },
              ],
            },
          }
        : { data: page([]) },
    );
    vi.spyOn(api, 'put').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Stage changed. Reload it.' } } },
    });
    const { app, container } = mountPanel(true);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Deactivate New'),
    );
    button(container, 'Deactivate New').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Stage changed.'),
    );
    updated = true;
    button(container, 'Reload stages').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Deactivate Updated'),
    );
    expect(container.textContent).not.toContain('Stage changed.');
    app.unmount();
  });
});
