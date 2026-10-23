import { useCallback, useEffect, useState } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text,
    TextInput, Divider, Pagination,
} from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';
import {
    type AdminUser,
    type AdminUserDetail,
    PER_PAGE,
    fetchAdminUsers,
    fetchAdminUserDetail,
    resetAdminUserPassword,
    deleteAdminUser,
} from '../api/admin';
import { UserTable } from '../components/admin/UserTable';
import { UserEditModal } from '../components/admin/UserEditModal';
import { UserDetailModal } from '../components/admin/UserDetailModal';
import { TempPasswordModal } from '../components/admin/TempPasswordModal';
import { UserCreateCard } from '../components/admin/UserCreateCard';
import { BroadcastCard } from '../components/admin/BroadcastCard';

export default function AdminDashboard() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');

    // モーダル・カードの状態
    const [editUser, setEditUser] = useState<AdminUser | null>(null);
    const [detail, setDetail] = useState<AdminUserDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [tempPassword, setTempPassword] = useState<{ account_name: string; password: string } | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [showBroadcastForm, setShowBroadcastForm] = useState(false);

    const navigate = useNavigate();
    const { logout, accountName } = useAuth();

    const fetchUsers = useCallback(async () => {
        try {
            const data = await fetchAdminUsers(page, PER_PAGE, search);
            setUsers(data.items);
            setTotal(data.total_count);
            setError('');
        } catch (err) {
            setError(getErrorMessage(err, 'ユーザー一覧の取得に失敗しました'));
        }
    }, [page, search]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const openDetail = async (user: AdminUser) => {
        setDetail(null);
        setDetailLoading(true);
        try {
            const data = await fetchAdminUserDetail(user.id);
            setDetail(data);
        } catch (err) {
            alert(getErrorMessage(err, '詳細の取得に失敗しました'));
        } finally {
            setDetailLoading(false);
        }
    };

    const handleResetPassword = async (user: AdminUser) => {
        if (!window.confirm(`"${user.account_name}" に仮パスワードを発行しますか？\n今のパスワードは使えなくなります。`)) return;
        try {
            const res = await resetAdminUserPassword(user.id);
            setTempPassword({ account_name: res.account_name, password: res.temporary_password });
        } catch (err) {
            alert(getErrorMessage(err, '仮パスワードの発行に失敗しました'));
        }
    };

    const handleDeleteUser = async (user: AdminUser) => {
        if (!window.confirm(`"${user.account_name}" を削除しますか？\n利用者フォルダは保管してから消します。この操作は取り消せません。`)) return;
        try {
            await deleteAdminUser(user.id);
            fetchUsers();
        } catch (err) {
            alert(getErrorMessage(err, 'ユーザーの削除に失敗しました'));
        }
    };

    const applySearch = () => {
        setPage(1);
        setSearch(searchInput.trim());
    };

    return (
        <AppShell header={{ height: 60 }} padding="md">
            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between">
                    <Title order={3}>Kawamonn Admin</Title>
                    <Group>
                        <Button variant="subtle" onClick={() => navigate('/')}>Storage</Button>
                        <Button variant="light" color="red" onClick={() => {
                            logout();
                            navigate('/admin/login');
                        }}>Logout</Button>
                    </Group>
                </Group>
            </AppShell.Header>

            <AppShell.Main>
                <Container size="xl">
                    <Group justify="space-between" mb="md">
                        <Title order={2}>ユーザー管理</Title>
                        <Group>
                            <Button variant="outline" onClick={() => setShowBroadcastForm(v => !v)}>
                                {showBroadcastForm ? 'キャンセル' : 'メッセージ一斉送信'}
                            </Button>
                            <Button onClick={() => setShowAddForm(v => !v)}>
                                {showAddForm ? 'キャンセル' : '+ ユーザーを追加'}
                            </Button>
                        </Group>
                    </Group>

                    {showBroadcastForm && (
                        <BroadcastCard onClose={() => setShowBroadcastForm(false)} />
                    )}

                    {showAddForm && (
                        <UserCreateCard onCreated={(created) => {
                            setShowAddForm(false);
                            if (created.temporary_password) {
                                setTempPassword({
                                    account_name: created.account_name,
                                    password: created.temporary_password,
                                });
                            }
                            fetchUsers();
                        }} />
                    )}

                    {error && <Text c="red" mb="md">{error}</Text>}

                    <Divider mb="md" />

                    <Group mb="sm">
                        <TextInput
                            placeholder="名前かメールアドレスで検索"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                            style={{ flex: 1, maxWidth: 360 }}
                        />
                        <Button variant="default" onClick={applySearch}>検索</Button>
                        <Text size="sm" c="dimmed">{total} 人</Text>
                    </Group>

                    <UserTable
                        users={users}
                        currentAccountName={accountName}
                        onDetail={openDetail}
                        onEdit={(user) => setEditUser(user)}
                        onResetPassword={handleResetPassword}
                        onDelete={handleDeleteUser}
                    />

                    {users.length === 0 && !error && (
                        <Text c="dimmed" ta="center" mt="xl">ユーザーが見つかりません</Text>
                    )}

                    {total > PER_PAGE && (
                        <Group justify="center" mt="md">
                            <Pagination total={Math.ceil(total / PER_PAGE)} value={page} onChange={setPage} />
                        </Group>
                    )}
                </Container>
            </AppShell.Main>

            <UserEditModal
                user={editUser}
                onClose={() => setEditUser(null)}
                onSaved={() => {
                    setEditUser(null);
                    fetchUsers();
                }}
            />

            <UserDetailModal
                detail={detail}
                loading={detailLoading}
                onClose={() => setDetail(null)}
            />

            <TempPasswordModal
                tempPassword={tempPassword}
                onClose={() => setTempPassword(null)}
            />
        </AppShell>
    );
}
