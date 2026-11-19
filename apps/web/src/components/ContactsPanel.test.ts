import { createApp } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import ContactsPanel from './ContactsPanel.vue';

const contact = {
  id: 'contact-id',
  name: 'Ada',
  email: 'ada@example.test',
  phone: null,
  archivedAt: null,
  version: 1,
};
const page = (contacts = [contact], total = contacts.length) => ({
  contacts,
  total,
  page: 1,
  pageSize: 20,
});
const base = '/organizations/org-id/contacts';

function mountPanel() {
  const container = document.createElement('div');
  const app = createApp(ContactsPanel, { organizationId: 'org-id' });
  app.mount(container);
  return { app, container };
}
function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function input(element: HTMLInputElement | null, value: string) {
  if (!element) throw new Error('Missing input');
  element.value = value;
  element.dispatchEvent(new Event('input'));
}

afterEach(() => vi.restoreAllMocks());

describe('contacts workspace', () => {
  it('creates a contact and displays its details', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: page([]) })
      .mockResolvedValueOnce({ data: page() });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { contact } });
    const { app, container } = mountPanel();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('No contacts found.'),
    );
    button(container, 'New contact').click();
    await vi.waitFor(() =>
      expect(container.querySelector('input[type=email]')).not.toBeNull(),
    );
    input(container.querySelector('input[required]'), 'Ada');
    input(container.querySelector('input[type=email]'), 'ada@example.test');
    container
      .querySelectorAll('form')[1]
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Contact saved.'),
    );
    expect(post).toHaveBeenCalledWith(base, {
      name: 'Ada',
      email: 'ada@example.test',
      phone: '',
    });
    expect(container.textContent).toContain('ada@example.test');
    app.unmount();
  });

  it('filters records and reloads a conflicting edit', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: page() })
      .mockResolvedValueOnce({ data: page() })
      .mockResolvedValueOnce({ data: { contact } })
      .mockResolvedValueOnce({
        data: { contact: { ...contact, name: 'Ada updated', version: 2 } },
      });
    vi.spyOn(api, 'put').mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: { message: 'This contact changed. Reload it before saving.' },
        },
      },
    });
    const { app, container } = mountPanel();
    await vi.waitFor(() => expect(container.textContent).toContain('View Ada'));
    input(container.querySelector('input[maxlength="100"]'), 'Ada');
    const select = container.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('Missing status filter');
    select.value = 'all';
    select.dispatchEvent(new Event('change'));
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(get).toHaveBeenCalledWith(base, {
        params: { q: 'Ada', status: 'all', page: 1 },
      }),
    );
    await vi.waitFor(() => expect(container.textContent).toContain('View Ada'));
    button(container, 'View Ada').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Edit contact'),
    );
    button(container, 'Edit contact').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Save contact'),
    );
    container
      .querySelectorAll('form')[1]
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('This contact changed.'),
    );
    button(container, 'Reload contact').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Ada updated'),
    );
    app.unmount();
  });
});
