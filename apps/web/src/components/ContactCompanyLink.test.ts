import { createApp, defineComponent, h, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import ContactCompanyLink from './ContactCompanyLink.vue';

const base = '/organizations/org-id';
const link = `${base}/contacts/contact-id/company`;
const company = { id: 'company-id', name: 'Acme', archivedAt: null };
function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
afterEach(() => vi.restoreAllMocks());

describe('contact company link', () => {
  it('searches, links and removes a company using the latest contact version', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { company: null } })
      .mockResolvedValueOnce({
        data: { companies: [company], total: 1, page: 1, pageSize: 20 },
      });
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValueOnce({ data: { company, contact: { version: 2 } } })
      .mockResolvedValueOnce({
        data: { company: null, contact: { version: 3 } },
      });
    const container = document.createElement('div');
    const wrapper = defineComponent({
      setup() {
        const version = ref(1);
        return () =>
          h(ContactCompanyLink, {
            organizationId: 'org-id',
            contactId: 'contact-id',
            version: version.value,
            onUpdated: (next: number) => {
              version.value = next;
            },
          });
      },
    });
    const app = createApp(wrapper);
    app.mount(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('No company linked.'),
    );
    const input = container.querySelector('input');
    if (!input) throw new Error('Missing company search');
    input.value = 'Acme';
    input.dispatchEvent(new Event('input'));
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Link Acme'),
    );
    expect(get).toHaveBeenCalledWith(`${base}/companies`, {
      params: { q: 'Acme', status: 'active', page: 1 },
    });
    button(container, 'Link Acme').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Company linked.'),
    );
    expect(put).toHaveBeenNthCalledWith(1, link, {
      companyId: 'company-id',
      version: 1,
    });
    button(container, 'Remove company link').click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Company link removed.'),
    );
    expect(put).toHaveBeenNthCalledWith(2, link, {
      companyId: null,
      version: 2,
    });
    app.unmount();
  });
});
