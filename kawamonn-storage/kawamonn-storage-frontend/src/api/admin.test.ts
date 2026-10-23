import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from './client';
import {
    fetchAdminUsers,
    updateAdminUserEmail,
    updateAdminUserQuota,
    fetchAdminUserDetail,
    resetAdminUserPassword,
    deleteAdminUser,
    createAdminUser,
    sendAdminBroadcast,
    formatDate,
    formatDateTime,
    GIB,
    PER_PAGE,
} from './admin';

vi.mock('./client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

describe('admin API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defines correct constants', () => {
        expect(GIB).toBe(1024 ** 3);
        expect(PER_PAGE).toBe(50);
    });

    it('formats date and datetime correctly', () => {
        expect(formatDate(null)).toBe('-');
        const dateStr = '2026-10-24T12:30:00.000Z';
        expect(formatDate(dateStr)).toMatch(/2026\/10\/24/);
        expect(formatDateTime(dateStr)).toMatch(/2026\/10\/24/);
    });

    it('calls fetchAdminUsers with correct params', async () => {
        (api.get as any).mockResolvedValue({
            data: { items: [{ id: '1', account_name: 'test' }], total_count: 1 },
        });

        const res = await fetchAdminUsers(1, 50, 'search-term');
        expect(api.get).toHaveBeenCalledWith('/api/v1/admin/users', {
            params: { page: 1, per_page: 50, search: 'search-term' },
        });
        expect(res.items).toHaveLength(1);
        expect(res.total_count).toBe(1);
    });

    it('calls updateAdminUserEmail and updateAdminUserQuota', async () => {
        (api.put as any).mockResolvedValue({ data: { success: true } });
        (api.post as any).mockResolvedValue({ data: { success: true } });

        await updateAdminUserEmail('u1', 'new@example.com');
        expect(api.put).toHaveBeenCalledWith('/api/v1/admin/users/u1', { email: 'new@example.com' });

        await updateAdminUserQuota('u1', 40);
        expect(api.post).toHaveBeenCalledWith('/api/v1/admin/users/u1/quota', { quota_gb: 40 });
    });

    it('calls fetchAdminUserDetail, resetPassword, and deleteAdminUser', async () => {
        (api.get as any).mockResolvedValue({ data: { id: 'u1', account_name: 'alice' } });
        (api.post as any).mockResolvedValue({ data: { temporary_password: 'pass' } });
        (api.delete as any).mockResolvedValue({ data: { success: true } });

        await fetchAdminUserDetail('u1');
        expect(api.get).toHaveBeenCalledWith('/api/v1/admin/users/u1');

        await resetAdminUserPassword('u1');
        expect(api.post).toHaveBeenCalledWith('/api/v1/admin/users/u1/reset-password');

        await deleteAdminUser('u1');
        expect(api.delete).toHaveBeenCalledWith('/api/v1/admin/users/u1');
    });

    it('calls createAdminUser and sendAdminBroadcast', async () => {
        (api.post as any).mockResolvedValue({ data: { id: 'new-u' } });

        await createAdminUser({ email: 'new@example.com', quota_gb: 20 });
        expect(api.post).toHaveBeenCalledWith('/api/v1/admin/users', {
            email: 'new@example.com',
            account_name: undefined,
            password: undefined,
            quota_gb: 20,
        });

        await sendAdminBroadcast('Title', 'Body');
        expect(api.post).toHaveBeenCalledWith('/api/v1/admin/broadcast', {
            subject: 'Title',
            message: 'Body',
        });
    });
});
