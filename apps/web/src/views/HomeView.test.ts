import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import HomeView from './HomeView.vue';

afterEach(() => vi.restoreAllMocks());

describe('service status', () => {
  it('shows when the API is healthy', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { status: 'ok' } });
    const wrapper = mount(HomeView);
    await flushPromises();
    expect(wrapper.text()).toContain('Services are online');
  });

  it('shows when the API is unavailable', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
    const wrapper = mount(HomeView);
    await flushPromises();
    expect(wrapper.text()).toContain('Service unavailable');
  });
});
