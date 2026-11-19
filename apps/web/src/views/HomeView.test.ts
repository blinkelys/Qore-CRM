import { createApp } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import HomeView from './HomeView.vue';

afterEach(() => vi.restoreAllMocks());

describe('service status', () => {
  it('shows when the API is healthy', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { status: 'ok' } });
    const app = createApp(HomeView);
    const container = document.createElement('div');
    app.mount(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Services are online'),
    );
    app.unmount();
  });

  it('shows when the API is unavailable', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
    const app = createApp(HomeView);
    const container = document.createElement('div');
    app.mount(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Service unavailable'),
    );
    app.unmount();
  });
});
