import axios from 'axios';
import { reactive } from 'vue';
import { api } from './api';

export interface User {
  id: string;
  email: string;
}

export type Role = 'owner' | 'admin' | 'member';
export interface Organization {
  id: string;
  name: string;
  role: Role;
}
export interface Member {
  id: string;
  email: string;
  role: Role;
}

export const auth = reactive<{ user: User | null }>({ user: null });
export const invitationKey = 'qore_pending_invitation';

export async function refreshSession() {
  try {
    const response = await api.get<{ user: User }>('/auth/session');
    auth.user = response.data.user;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      auth.user = null;
      return;
    }
    throw error;
  }
}
