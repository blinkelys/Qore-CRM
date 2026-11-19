import { createApp, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { auth, invitationKey } from '../auth';
import AuthView from './AuthView.vue';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  auth.user = null;
});

describe('sign in', () => {
  it('continues a pending invitation after signing in', async () => {
    sessionStorage.setItem(invitationKey, 'pending-token');
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { user: { id: 'user-id', email: 'member@example.test' } },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: AuthView, props: { mode: 'login' } },
        {
          path: '/accept-invitation',
          component: { template: '<p>Invitation</p>' },
        },
      ],
    });
    await router.push('/login');
    const container = document.createElement('div');
    const app = createApp({ render: () => h(RouterView) }).use(router);
    app.mount(container);
    const email =
      container.querySelector<HTMLInputElement>('input[type=email]');
    const password = container.querySelector<HTMLInputElement>(
      'input[type=password]',
    );
    if (!email || !password) throw new Error('Sign-in inputs are missing');
    email.value = 'member@example.test';
    email.dispatchEvent(new Event('input'));
    password.value = 'a secure password 123';
    password.dispatchEvent(new Event('input'));
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe('/accept-invitation'),
    );
    expect(post).toHaveBeenCalledWith('/auth/login', {
      email: 'member@example.test',
      password: 'a secure password 123',
    });
    expect(auth.user?.email).toBe('member@example.test');
    app.unmount();
  });
});
