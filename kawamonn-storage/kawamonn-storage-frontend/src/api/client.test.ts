import { describe, it, expect, beforeEach } from 'vitest';
import type { AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';
import api from './client';

/**
 * Rather than mocking axios itself, this swaps the instance's HTTP adapter
 * for a stub that either echoes back the request config (to inspect what the
 * request interceptor attached) or rejects with a synthetic AxiosError (to
 * drive the response interceptor's 401 handling) — exercising the real
 * interceptor logic registered on `api`, not a reimplementation of it.
 */
function make401Error(): AxiosError {
    const error = new Error('Unauthorized') as AxiosError;
    error.isAxiosError = true;
    error.response = {
        status: 401,
        data: {},
        statusText: 'Unauthorized',
        headers: {},
        config: { headers: {} } as InternalAxiosRequestConfig,
    };
    return error;
}

function stubLocation() {
    Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
        configurable: true,
    });
}

function authHeader(config: AxiosRequestConfig | undefined): string | undefined {
    return (config?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('api client', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('request interceptor', () => {
        it('attaches Authorization header when a token is present', async () => {
            localStorage.setItem('token', 'abc123');
            let captured: AxiosRequestConfig | undefined;
            api.defaults.adapter = async (config) => {
                captured = config;
                return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
            };

            await api.get('/whatever');

            expect(authHeader(captured)).toBe('Bearer abc123');
        });

        it('omits the Authorization header when no token is present', async () => {
            let captured: AxiosRequestConfig | undefined;
            api.defaults.adapter = async (config) => {
                captured = config;
                return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
            };

            await api.get('/whatever');

            expect(authHeader(captured)).toBeUndefined();
        });
    });

    describe('response interceptor (401 handling)', () => {
        it('clears storage and redirects to /login on 401 when a session token existed', async () => {
            localStorage.setItem('token', 'abc');
            localStorage.setItem('role', 'user');
            stubLocation();
            api.defaults.adapter = async () => {
                throw make401Error();
            };

            await expect(api.get('/whatever')).rejects.toBeTruthy();

            expect(localStorage.getItem('token')).toBeNull();
            expect(window.location.href).toBe('/login');
        });

        it('redirects to /admin/login on 401 when the stored role was admin', async () => {
            localStorage.setItem('token', 'abc');
            localStorage.setItem('role', 'admin');
            stubLocation();
            api.defaults.adapter = async () => {
                throw make401Error();
            };

            await expect(api.get('/whatever')).rejects.toBeTruthy();

            expect(window.location.href).toBe('/admin/login');
        });

        it('does nothing on 401 when there was no prior token (e.g. a bad login attempt)', async () => {
            // No token set: this mirrors submitting the wrong password on the login form.
            stubLocation();
            window.location.href = '/login'; // where the user already is
            api.defaults.adapter = async () => {
                throw make401Error();
            };

            await expect(api.get('/whatever')).rejects.toBeTruthy();

            // Interceptor must leave everything untouched so the caller's own
            // catch block (e.g. "invalid credentials" inline error) still runs.
            expect(window.location.href).toBe('/login');
        });
    });
});
