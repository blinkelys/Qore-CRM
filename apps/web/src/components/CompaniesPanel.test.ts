import { createApp } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import CompaniesPanel from './CompaniesPanel.vue';

const company = {
  id: 'company-id',
  name: 'Acme',
  website: 'https://acme.test',
  phone: null,
  archivedAt: null,
  version: 1,
};
const page = (companies = [company]) => ({
  companies,
  total: companies.length,
  page: 1,
  pageSize: 20,
});
const base = '/organizations/org-id/companies';
function mountPanel(timelineEnabled = false) {
  const container = document.createElement('div');
  const app = createApp(CompaniesPanel, {
    organizationId: 'org-id',
    timelineEnabled,
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
function setInput(element: HTMLInputElement | null, value: string) {
  if (!element) throw new Error('Missing input');
  element.value = value;
  element.dispatchEvent(new Event('input'));
}
afterEach(() => vi.restoreAllMocks());

describe('companies workspace', () => {
  it('creates a company and shows its details', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: page([]) })
      .mockResolvedValueOnce({ data: page() });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { company } });
    const { app, container } = mountPanel();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('No companies found.'),
    );
    button(container, 'New company').click();
    await vi.waitFor(() =>
      expect(container.querySelector('input[type=url]')).not.toBeNull(),
    );
    setInput(container.querySelector('input[required]'), 'Acme');
    setInput(container.querySelector('input[type=url]'), 'https://acme.test');
    container
      .querySelectorAll('form')[1]
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Company saved.'),
    );
    expect(post).toHaveBeenCalledWith(base, {
      name: 'Acme',
      website: 'https://acme.test',
      phone: '',
    });
    expect(container.querySelector('a')?.href).toBe('https://acme.test/');
    app.unmount();
  });

  it('allows reloading after a conflicting update', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: page() })
      .mockResolvedValueOnce({ data: { company } })
      .mockResolvedValueOnce({
        data: { company: { ...company, name: 'Acme updated', version: 2 } },
      });
    vi.spyOn(api, 'put').mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: { message: 'This company changed. Reload it before saving.' },
        },
      },
    });
    const { app, container } = mountPanel();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('View Acme'),
    );
    button(container, 'View Acme').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Edit company'),
    );
    button(container, 'Edit company').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Save company'),
    );
    container
      .querySelectorAll('form')[1]
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('This company changed.'),
    );
    button(container, 'Reload company').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Acme updated'),
    );
    app.unmount();
  });

  it('shows history for a selected company when the timeline module is enabled', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: page() })
      .mockResolvedValueOnce({ data: { company } })
      .mockResolvedValueOnce({
        data: { entries: [], total: 0, page: 1, pageSize: 20 },
      });
    const { app, container } = mountPanel(true);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('View Acme'),
    );
    button(container, 'View Acme').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('No entries yet.'),
    );
    expect(get).toHaveBeenCalledWith(`${base}/company-id/timeline`, {
      params: { page: 1 },
    });
    app.unmount();
  });
});
