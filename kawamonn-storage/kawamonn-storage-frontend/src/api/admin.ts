import api from './client';

export interface AdminUser {
    id: string;
    account_name: string;
    email: string;
    role: string;
    status: string;
    used_bytes: string;
    quota_bytes: string;
    expiry_at: string | null;
    created_at: string;
}

export interface AuditLog {
    id: string;
    action: string;
    actor_id: string | null;
    target_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
}

export interface AdminUserDetail extends AdminUser {
    updated_at: string;
    last_reminder_sent: string | null;
    password_last_set_at: string | null;
    audit_logs: AuditLog[];
}

export interface CreateUserPayload {
    email: string;
    account_name?: string;
    password?: string;
    quota_gb: number;
}

export interface UsersResponse {
    items: AdminUser[];
    total_count: number;
    page: number;
    per_page: number;
}

export const GIB = 1024 ** 3;
export const PER_PAGE = 50;

export const ACTION_LABELS: Record<string, string> = {
    admin_create_user: '管理者が作成',
    admin_update_email: 'メールアドレスの変更',
    admin_update_quota: '容量の変更',
    admin_reset_password: '仮パスワードの発行',
    admin_delete_user: '管理者が削除',
    forgot_password_req: 'パスワード再設定の申請',
    password_reset_success: 'パスワードの再設定',
    auto_cleanup: '期限切れで削除',
};

export function formatDate(dateString: string | null) {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(dateString: string) {
    const d = new Date(dateString);
    return `${formatDate(dateString)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function fetchAdminUsers(page: number, perPage: number = PER_PAGE, search?: string): Promise<UsersResponse> {
    const res = await api.get('/api/v1/admin/users', {
        params: { page, per_page: perPage, search: search || undefined },
    });
    return {
        items: res.data.items ?? [],
        total_count: res.data.total_count ?? 0,
        page: res.data.page ?? page,
        per_page: res.data.per_page ?? perPage,
    };
}

export async function updateAdminUserEmail(id: string, email: string) {
    const res = await api.put(`/api/v1/admin/users/${id}`, { email });
    return res.data;
}

export async function updateAdminUserQuota(id: string, quotaGb: number) {
    const res = await api.post(`/api/v1/admin/users/${id}/quota`, { quota_gb: quotaGb });
    return res.data;
}

export async function fetchAdminUserDetail(id: string): Promise<AdminUserDetail> {
    const res = await api.get(`/api/v1/admin/users/${id}`);
    return res.data;
}

export async function resetAdminUserPassword(id: string): Promise<{ account_name: string; temporary_password: string }> {
    const res = await api.post(`/api/v1/admin/users/${id}/reset-password`);
    return res.data;
}

export async function deleteAdminUser(id: string) {
    const res = await api.delete(`/api/v1/admin/users/${id}`);
    return res.data;
}

export async function createAdminUser(payload: CreateUserPayload): Promise<{
    id: string;
    account_name: string;
    temporary_password?: string;
}> {
    const res = await api.post('/api/v1/admin/users', {
        email: payload.email,
        account_name: payload.account_name || undefined,
        password: payload.password || undefined,
        quota_gb: payload.quota_gb,
    });
    return res.data;
}

export async function sendAdminBroadcast(subject: string, message: string): Promise<{ recipientCount: number }> {
    const res = await api.post('/api/v1/admin/broadcast', { subject, message });
    return res.data;
}
