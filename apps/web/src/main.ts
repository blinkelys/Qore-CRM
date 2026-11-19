import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import AcceptInvitationView from './views/AcceptInvitationView.vue';
import AuthView from './views/AuthView.vue';
import HomeView from './views/HomeView.vue';
import WorkspaceView from './views/WorkspaceView.vue';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/login', component: AuthView, props: { mode: 'login' } },
    { path: '/register', component: AuthView, props: { mode: 'register' } },
    {
      path: '/forgot-password',
      component: AuthView,
      props: { mode: 'forgot' },
    },
    { path: '/reset-password', component: AuthView, props: { mode: 'reset' } },
    { path: '/accept-invitation', component: AcceptInvitationView },
    { path: '/workspace', component: WorkspaceView },
  ],
});

createApp(App).use(router).mount('#app');
