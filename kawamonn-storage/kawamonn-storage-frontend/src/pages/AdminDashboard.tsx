import { useCallback, useEffect, useState } from 'react';
import {
    AppShell, Group, Title, Button, Table, Container, Text, Badge, CopyButton,
    NumberInput, TextInput, Textarea, PasswordInput, Card, Stack, Divider, Modal, Loader, Pagination, ScrollArea,
} from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { formatBytes } from '../api/files';
import { useAuth } from '../AuthContext';

interface User {
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

interface AuditLog {
    id: string;
    action: string;
    actor_id: string | null;
    target_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
}

interface UserDetail extends User {
    updated_at: string;
    last_reminder_sent: string | null;
    password_last_set_at: string | null;
    audit_logs: AuditLog[];
}

// 容量の「GB」は 1024^3 バイト(backend の既定の 20GB = 21474836480 と同じ数え方)
const GIB = 1024 ** 3;
const PER_PAGE = 50;

const ACTION_LABELS: Record<string, string> = {
    admin_create_user: '管理者が作成',
    admin_update_email: 'メールアドレスの変更',
    admin_update_quota: '容量の変更',
    admin_reset_password: '仮パスワードの発行',
    admin_delete_user: '管理者が削除',
    forgot_password_req: 'パスワード再設定の申請',
    password_reset_success: 'パスワードの再設定',
    auto_cleanup: '期限切れで削除',
};

function formatDate(dateString: string | null) {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateTime(dateString: string) {
    const d = new Date(dateString);
    return `${formatDate(dateString)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function AdminDashboard() {
    const [users, setUsers] = useState<User[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');

    // 編集(メールアドレスと容量)
    const [editUser, setEditUser] = useState<User | null>(null);
    const [editEmail, setEditEmail] = useState('');
    const [editQuotaGB, setEditQuotaGB] = useState(20);
    const [editError, setEditError] = useState('');

    // 詳細
    const [detail, setDetail] = useState<UserDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // 仮パスワード(一度だけ表示する)
    const [tempPassword, setTempPassword] = useState<{ account_name: string; password: string } | null>(null);

    // 追加
    const [showAddForm, setShowAddForm] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', account_name: '', password: '', quota_gb: 20 });
    const [addError, setAddError] = useState('');

    // 一斉送信
    const [showBroadcastForm, setShowBroadcastForm] = useState(false);
    const [broadcastSubject, setBroadcastSubject] = useState('');
    const [broadcastMessage, setBroadcastMessage] = useState('');
    const [broadcastStatus, setBroadcastStatus] = useState({ type: '', message: '' });

    const navigate = useNavigate();
    const { logout, accountName } = useAuth();

    const fetchUsers = useCallback(async () => {
        try {
            const res = await api.get('/api/v1/admin/users', {
                params: { page, per_page: PER_PAGE, search: search || undefined },
            });
            setUsers(res.data.items ?? []);
            setTotal(res.data.total_count ?? 0);
            setError('');
        } catch (err) {
            setError(getErrorMessage(err, 'ユーザー一覧の取得に失敗しました'));
        }
    }, [page, search]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const openEdit = (user: User) => {
        setEditUser(user);
        setEditEmail(user.email);
        setEditQuotaGB(Math.round(Number(user.quota_bytes) / GIB));
        setEditError('');
    };

    const handleUpdateUser = async () => {
        if (!editUser) return;
        setEditError('');
        try {
            if (editEmail !== editUser.email) {
                await api.put(`/api/v1/admin/users/${editUser.id}`, { email: editEmail });
            }
            if (editQuotaGB * GIB !== Number(editUser.quota_bytes)) {
                await api.post(`/api/v1/admin/users/${editUser.id}/quota`, { quota_gb: editQuotaGB });
            }
            setEditUser(null);
            fetchUsers();
        } catch (err) {
            setEditError(getErrorMessage(err, 'ユーザー情報の更新に失敗しました'));
        }
    };

    const openDetail = async (user: User) => {
        setDetail(null);
        setDetailLoading(true);
        try {
            const res = await api.get(`/api/v1/admin/users/${user.id}`);
            setDetail(res.data);
        } catch (err) {
            alert(getErrorMessage(err, '詳細の取得に失敗しました'));
        } finally {
            setDetailLoading(false);
        }
    };

    const handleResetPassword = async (user: User) => {
        if (!window.confirm(`"${user.account_name}" に仮パスワードを発行しますか？\n今のパスワードは使えなくなります。`)) return;
        try {
            const res = await api.post(`/api/v1/admin/users/${user.id}/reset-password`);
            setTempPassword({ account_name: res.data.account_name, password: res.data.temporary_password });
        } catch (err) {
            alert(getErrorMessage(err, '仮パスワードの発行に失敗しました'));
        }
    };

    const handleDeleteUser = async (user: User) => {
        if (!window.confirm(`"${user.account_name}" を削除しますか？\n利用者フォルダは保管してから消します。この操作は取り消せません。`)) return;
        try {
            await api.delete(`/api/v1/admin/users/${user.id}`);
            fetchUsers();
        } catch (err) {
            alert(getErrorMessage(err, 'ユーザーの削除に失敗しました'));
        }
    };

    const handleCreateUser = async () => {
        setAddError('');
        if (!newUser.email) { setAddError('メールアドレスは必須です'); return; }
        try {
            const res = await api.post('/api/v1/admin/users', {
                email: newUser.email,
                account_name: newUser.account_name || undefined,
                // Omit password entirely when blank so the backend generates one,
                // instead of sending '' (which would fail minimum-length validation).
                password: newUser.password || undefined,
                quota_gb: newUser.quota_gb,
            });
            setShowAddForm(false);
            setNewUser({ email: '', account_name: '', password: '', quota_gb: 20 });
            if (res.data.temporary_password) {
                setTempPassword({ account_name: res.data.account_name, password: res.data.temporary_password });
            }
            fetchUsers();
        } catch (err) {
            setAddError(getErrorMessage(err, 'ユーザー作成に失敗しました'));
        }
    };

    const handleBroadcast = async () => {
        setBroadcastStatus({ type: '', message: '' });
        if (!broadcastSubject || !broadcastMessage) {
            setBroadcastStatus({ type: 'error', message: '件名と本文を入力してください' });
            return;
        }
        if (!window.confirm('有効な利用者全員にメールを送ります。よろしいですか？')) return;
        try {
            const res = await api.post('/api/v1/admin/broadcast',
                { subject: broadcastSubject, message: broadcastMessage }
            );
            setBroadcastStatus({ type: 'success', message: `${res.data.recipientCount ?? 0} 人に送信しました` });
            setTimeout(() => {
                setShowBroadcastForm(false);
                setBroadcastSubject('');
                setBroadcastMessage('');
                setBroadcastStatus({ type: '', message: '' });
            }, 3000);
        } catch (err) {
            setBroadcastStatus({ type: 'error', message: getErrorMessage(err, '送信に失敗しました') });
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
                    {/* Header row */}
                    <Group justify="space-between" mb="md">
                        <Title order={2}>ユーザー管理</Title>
                        <Group>
                            <Button variant="outline" onClick={() => { setShowBroadcastForm(v => !v); setBroadcastStatus({ type: '', message: '' }); }}>
                                {showBroadcastForm ? 'キャンセル' : 'メッセージ一斉送信'}
                            </Button>
                            <Button onClick={() => { setShowAddForm(v => !v); setAddError(''); }}>
                                {showAddForm ? 'キャンセル' : '+ ユーザーを追加'}
                            </Button>
                        </Group>
                    </Group>

                    {/* Inline Broadcast form */}
                    {showBroadcastForm && (
                        <Card withBorder shadow="sm" radius="md" p="md" mb="lg" style={{ maxWidth: 600 }}>
                            <Text fw={600} mb="sm">有効な利用者全員へメッセージを一斉送信</Text>
                            <Stack gap="sm">
                                <TextInput
                                    label="件名"
                                    placeholder="お知らせ：メンテナンスについて"
                                    required
                                    value={broadcastSubject}
                                    onChange={(e) => setBroadcastSubject(e.target.value)}
                                />
                                <Textarea
                                    label="本文"
                                    placeholder="メッセージ内容を入力してください"
                                    required
                                    autosize
                                    minRows={4}
                                    value={broadcastMessage}
                                    onChange={(e) => setBroadcastMessage(e.target.value)}
                                />
                                {broadcastStatus.message && (
                                    <Text c={broadcastStatus.type === 'error' ? 'red' : 'green'} size="sm">
                                        {broadcastStatus.message}
                                    </Text>
                                )}
                                <Button onClick={handleBroadcast}>送信する</Button>
                            </Stack>
                        </Card>
                    )}

                    {/* Inline Add User form */}
                    {showAddForm && (
                        <Card withBorder shadow="sm" radius="md" p="md" mb="lg" style={{ maxWidth: 480 }}>
                            <Text fw={600} mb="sm">例外ユーザーを追加</Text>
                            <Stack gap="sm">
                                <TextInput
                                    label="メールアドレス"
                                    placeholder="user@example.com"
                                    required
                                    value={newUser.email}
                                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                />
                                <TextInput
                                    label="アカウント名（任意）"
                                    placeholder="空欄の場合はメールアドレスの @ の前"
                                    value={newUser.account_name}
                                    onChange={(e) => setNewUser({ ...newUser, account_name: e.target.value })}
                                />
                                <PasswordInput
                                    label="初期パスワード（任意）"
                                    placeholder="空欄の場合は仮パスワードを作って表示"
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                />
                                <NumberInput
                                    label="ストレージ容量 (GB)"
                                    value={newUser.quota_gb}
                                    onChange={(val) => setNewUser({ ...newUser, quota_gb: Number(val) })}
                                    min={1}
                                    allowDecimal={false}
                                />
                                {addError && <Text c="red" size="sm">{addError}</Text>}
                                <Button onClick={handleCreateUser}>作成</Button>
                            </Stack>
                        </Card>
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

                    {/* User table */}
                    <ScrollArea>
                        <Table striped highlightOnHover withTableBorder withColumnBorders miw={900}>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>アカウント名</Table.Th>
                                    <Table.Th>メール</Table.Th>
                                    <Table.Th>ロール</Table.Th>
                                    <Table.Th>ストレージ使用量</Table.Th>
                                    <Table.Th>登録日</Table.Th>
                                    <Table.Th>期限</Table.Th>
                                    <Table.Th>操作</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {users.map((user) => (
                                    <Table.Tr key={user.id}>
                                        <Table.Td>
                                            <Group gap={6}>
                                                {user.account_name}
                                                {user.status !== 'active' && <Badge size="xs" color="gray">{user.status}</Badge>}
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>{user.email}</Table.Td>
                                        <Table.Td>{user.role}</Table.Td>
                                        <Table.Td>
                                            {formatBytes(Number(user.used_bytes))} / {formatBytes(Number(user.quota_bytes))}
                                        </Table.Td>
                                        <Table.Td>{formatDate(user.created_at)}</Table.Td>
                                        <Table.Td>{formatDate(user.expiry_at)}</Table.Td>
                                        <Table.Td>
                                            <Group gap="xs" wrap="nowrap">
                                                <Button size="xs" variant="default" onClick={() => openDetail(user)}>
                                                    詳細
                                                </Button>
                                                <Button size="xs" variant="light" onClick={() => openEdit(user)}>
                                                    編集
                                                </Button>
                                                <Button size="xs" variant="light" color="orange" onClick={() => handleResetPassword(user)}>
                                                    仮パスワード
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    color="red"
                                                    variant="light"
                                                    disabled={user.account_name === accountName}
                                                    title={user.account_name === accountName ? '自分自身は削除できません' : undefined}
                                                    onClick={() => handleDeleteUser(user)}
                                                >
                                                    削除
                                                </Button>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
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

            {/* 編集 */}
            <Modal opened={editUser !== null} onClose={() => setEditUser(null)} title={`ユーザー編集: ${editUser?.account_name ?? ''}`}>
                <Stack gap="sm">
                    <TextInput
                        label="メールアドレス"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                    />
                    <NumberInput
                        label="ストレージ容量 (GB)"
                        value={editQuotaGB}
                        onChange={(val) => setEditQuotaGB(Number(val))}
                        min={1}
                        allowDecimal={false}
                    />
                    {editError && <Text c="red" size="sm">{editError}</Text>}
                    <Group gap="xs" justify="flex-end">
                        <Button variant="subtle" color="gray" onClick={() => setEditUser(null)}>キャンセル</Button>
                        <Button onClick={handleUpdateUser}>保存</Button>
                    </Group>
                </Stack>
            </Modal>

            {/* 詳細 */}
            <Modal
                opened={detailLoading || detail !== null}
                onClose={() => setDetail(null)}
                title={detail ? `ユーザーの詳細: ${detail.account_name}` : 'ユーザーの詳細'}
                size="xl"
            >
                {detailLoading || !detail ? (
                    <Group justify="center" py="xl"><Loader size="sm" /></Group>
                ) : (
                    <Stack gap="md">
                        <Table withTableBorder>
                            <Table.Tbody>
                                {[
                                    ['メール', detail.email],
                                    ['ロール / 状態', `${detail.role} / ${detail.status}`],
                                    ['ストレージ', `${formatBytes(Number(detail.used_bytes))} / ${formatBytes(Number(detail.quota_bytes))}`],
                                    ['登録日', formatDate(detail.created_at)],
                                    ['期限', formatDate(detail.expiry_at)],
                                    ['パスワードを設定した日', formatDate(detail.password_last_set_at)],
                                    ['期限のお知らせを送った日', formatDate(detail.last_reminder_sent)],
                                ].map(([label, value]) => (
                                    <Table.Tr key={label}>
                                        <Table.Th w={200}>{label}</Table.Th>
                                        <Table.Td>{value}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                        <Text fw={600}>操作の記録（新しい順に50件まで）</Text>
                        {detail.audit_logs.length === 0 ? (
                            <Text size="sm" c="dimmed">記録はありません</Text>
                        ) : (
                            <ScrollArea h={300}>
                                <Table striped>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>日時</Table.Th>
                                            <Table.Th>操作</Table.Th>
                                            <Table.Th>内容</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {detail.audit_logs.map((log) => (
                                            <Table.Tr key={log.id}>
                                                <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</Table.Td>
                                                <Table.Td>{ACTION_LABELS[log.action] ?? log.action}</Table.Td>
                                                <Table.Td>
                                                    <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                                                        {log.metadata ? JSON.stringify(log.metadata) : ''}
                                                    </Text>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            </ScrollArea>
                        )}
                    </Stack>
                )}
            </Modal>

            {/* 仮パスワード(一度だけ表示) */}
            <Modal opened={tempPassword !== null} onClose={() => setTempPassword(null)} title="仮パスワード">
                <Stack gap="sm">
                    <Text size="sm">
                        「{tempPassword?.account_name}」の仮パスワードです。この画面を閉じると二度と表示できません。
                        本人に安全な方法で伝え、ログイン後に設定画面で変えてもらってください。
                    </Text>
                    <Group gap="xs">
                        <TextInput value={tempPassword?.password ?? ''} readOnly style={{ flex: 1 }} styles={{ input: { fontFamily: 'monospace' } }} />
                        <CopyButton value={tempPassword?.password ?? ''}>
                            {({ copied, copy }) => (
                                <Button color={copied ? 'teal' : 'blue'} onClick={copy}>
                                    {copied ? 'コピーしました' : 'コピー'}
                                </Button>
                            )}
                        </CopyButton>
                    </Group>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setTempPassword(null)}>閉じる</Button>
                    </Group>
                </Stack>
            </Modal>
        </AppShell>
    );
}
