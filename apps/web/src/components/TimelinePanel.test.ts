import { createApp } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import TimelinePanel from './TimelinePanel.vue';

const base = '/organizations/org-id/contacts/contact-id/timeline';
const entry = {
  id: 'entry-id',
  kind: 'call',
  body: 'Discussed <contract>',
  createdAt: '2026-11-19T10:00:00.000Z',
  author: { id: 'user-id', email: 'member@example.test' },
};
const page = (entries = [entry], pageNumber = 1, total = entries.length) => ({
  entries,
  total,
  page: pageNumber,
  pageSize: 20,
});
function mountPanel(recordType: 'contacts' | 'companies' = 'contacts') {
  const container = document.createElement('div');
  const app = createApp(TimelinePanel, {
    organizationId: 'org-id',
    recordType,
    recordId: recordType === 'contacts' ? 'contact-id' : 'company-id',
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
afterEach(() => vi.restoreAllMocks());

describe('record timeline', () => {
  it('adds a typed entry and renders its author, time, and text safely', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: page([]) })
      .mockResolvedValueOnce({ data: page() });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { entry } });
    const { app, container } = mountPanel();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('No entries yet.'),
    );
    const select = container.querySelector('select');
    const textarea = container.querySelector('textarea');
    if (!select || !textarea) throw new Error('Missing timeline form');
    select.value = 'call';
    select.dispatchEvent(new Event('change'));
    textarea.value = entry.body;
    textarea.dispatchEvent(new Event('input'));
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('member@example.test'),
    );
    expect(post).toHaveBeenCalledWith(base, { kind: 'call', body: entry.body });
    expect(container.textContent).toContain(entry.body);
    expect(container.querySelector('contract')).toBeNull();
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
      entry.createdAt,
    );
    expect(container.querySelector('textarea')?.value).toBe('');
    app.unmount();
  });

  it('retries the requested history page after a failed load', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: page([entry], 1, 21) })
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { data: { error: { message: 'History unavailable.' } } },
      })
      .mockResolvedValueOnce({ data: page([entry], 2, 21) });
    const { app, container } = mountPanel('companies');
    await vi.waitFor(() => expect(container.textContent).toContain('Page 1'));
    button(container, 'Next').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('History unavailable.'),
    );
    button(container, 'Retry history').click();
    await vi.waitFor(() => expect(container.textContent).toContain('Page 2'));
    expect(get).toHaveBeenLastCalledWith(
      '/organizations/org-id/companies/company-id/timeline',
      { params: { page: 2 } },
    );
    app.unmount();
  });
});
