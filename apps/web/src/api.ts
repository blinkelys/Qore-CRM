import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 5000 });

export function errorMessage(error: unknown) {
  if (axios.isAxiosError<{ error?: { message?: string } }>(error)) {
    return (
      error.response?.data?.error?.message ??
      'Could not reach the server. Please try again.'
    );
  }
  return 'An unexpected error occurred. Please try again.';
}
