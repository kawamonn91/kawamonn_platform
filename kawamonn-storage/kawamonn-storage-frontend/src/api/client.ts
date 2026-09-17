import axios from 'axios';
import { Capacitor } from '@capacitor/core';

// Single axios instance for the whole app: attaches the bearer token to every
// request, and — only when a session actually existed (a token was present) —
// clears storage and redirects on 401, instead of every page re-implementing
// (or forgetting to implement) this. A 401 with no prior token (e.g. a wrong
// password on the login form) is left alone so the caller's own error UI runs.
const api = axios.create({
    baseURL: Capacitor.isNativePlatform() ? 'https://storage.kawamonn.com' : undefined,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        const hadSession = !!localStorage.getItem('token');
        if (axios.isAxiosError(error) && error.response?.status === 401 && hadSession) {
            const wasAdmin = localStorage.getItem('role') === 'admin';
            localStorage.clear();
            window.location.href = wasAdmin ? '/admin/login' : '/login';
        }
        return Promise.reject(error);
    }
);

export default api;
