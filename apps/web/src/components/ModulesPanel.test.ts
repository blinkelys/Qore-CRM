import { createApp } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import ModulesPanel from './ModulesPanel.vue';

const module = {
  key: 'organization-profile',
  name: 'Organization profile',
  description: 'Share a profile.',
  version: 1,
  dependencies: [],
  permissions: {
    read: ['owner', 'admin', 'member'],
    manage: ['owner', 'admin'],
  },
  navigation: {
    label: 'Organization profile',
    anchor: '#module-organization-profile',
  },
  entitled: true,
};
const available = { ...module, enabled: false, status: 'available' };
const enabled = { ...module, enabled: true, status: 'enabled' };

function mountPanel(role: 'owner' | 'member') {
  const container = document.createElement('div');
  const app = createApp(ModulesPanel, { organizationId: 'org-id', role });
  app.mount(container);
  return { app, container };
}

afterEach(() => vi.restoreAllMocks());

describe('module management', () => {
  it('enables, edits, and disables an organization profile', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { modules: [available] } })
      .mockResolvedValueOnce({ data: { modules: [enabled] } })
      .mockResolvedValueOnce({
        data: { settings: { description: '', website: '' } },
      })
      .mockResolvedValueOnce({ data: { modules: [available] } });
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: {
          settings: {
            description: 'Our team',
            website: 'https://example.test',
          },
        },
      })
      .mockResolvedValueOnce({ data: {} });
    const { app, container } = mountPanel('owner');
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Enable Organization profile'),
    );
    container.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() =>
      expect(container.querySelector('textarea')).not.toBeNull(),
    );
    const description =
      container.querySelector<HTMLTextAreaElement>('textarea');
    const website =
      container.querySelector<HTMLInputElement>('input[type=url]');
    if (!description || !website)
      throw new Error('Profile settings are missing');
    description.value = 'Our team';
    description.dispatchEvent(new Event('input'));
    website.value = 'https://example.test';
    website.dispatchEvent(new Event('input'));
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Organization profile saved.'),
    );
    expect(put).toHaveBeenNthCalledWith(
      2,
      '/organizations/org-id/modules/organization-profile/settings',
      {
        description: 'Our team',
        website: 'https://example.test',
      },
    );
    const disable = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Disable Organization profile'),
    );
    if (!disable) throw new Error('Disable button is missing');
    disable.click();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Enable Organization profile'),
    );
    expect(container.querySelector('textarea')).toBeNull();
    app.unmount();
  });

  it('shows enabled profile data without management controls to a member', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { modules: [enabled] } })
      .mockResolvedValueOnce({
        data: { settings: { description: 'Member-visible', website: '' } },
      });
    const { app, container } = mountPanel('member');
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Member-visible'),
    );
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).not.toContain('Disable Organization profile');
    app.unmount();
  });

  it('hides controls and profile content when the entitlement is missing', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: {
        modules: [{ ...enabled, entitled: false, status: 'unavailable' }],
      },
    });
    const { app, container } = mountPanel('owner');
    await vi.waitFor(() =>
      expect(container.textContent).toContain('unavailable'),
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    app.unmount();
  });
});
