import { useEffect, useState } from 'react';
import {
    AppShell, Group, Title, Button, Table, Container, Text,
    NumberInput, TextInput, PasswordInput, Card, Stack, Divider
} from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

interface User {
    id: string;
    account_name: string;
    email: string;
    role: string;
    used_bytes: string;
    quota_bytes: string;
    created_at: string;
}

export default function AdminDashboard() {
    const [users, setUsers] = useState<User[]>([]);
    const [error, setError] = useState('');

    // Edit state
    const [editUser, setEditUser] = useState<User | null>(null);
    const [editQuotaGB, setEditQuotaGB] = useState<number>(20);
    const [editEmail, setEditEmail] = useState<string>('');

    // Add user state
    const [showAddForm, setShowAddForm] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', account_name: '', password: '', quota_gb: 20 });
    const [addError, setAddError] = useState('');

    // Broadcast state
    const [showBroadcastForm, setShowBroadcastForm] = useState(false);
    const [broadcastSubject, setBroadcastSubject] = useState('');
    const [broadcastMessage, setBroadcastMessage] = useState('');
    const [broadcastStatus, setBroadcastStatus] = useState({ type: '', message: '' });

    const navigate = useNavigate();

    useEffect(() => { fetchUsers(); }, []);

    const fetchUsers = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/v1/admin/users', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(Array.isArray(res.data) ? res.data : []);
            setError('');
        } catch (err: any) {
            setError(err.response?.data?.message || 'ユーザー一覧の取得に失敗しました');
            if (axios.isAxiosError(err) && err.response?.status === 401) navigate('/admin/login');
        }
    };

    const handleUpdateUser = async () => {
        if (!editUser) return;
        try {
            const token = localStorage.getItem('token');
            const quotaBytes = (editQuotaGB * 1e9).toString();
            await axios.put(`/api/v1/admin/users/${editUser.id}`,
                { quota_bytes: quotaBytes, email: editEmail },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setEditUser(null);
            fetchUsers();
        } catch {
            alert('ユーザー情報の更新に失敗しました');
        }
    };

    const handleDeleteUser = async (id: string, name: string) => {
        if (!window.confirm(`"${name}" を削除しますか？この操作は取り消せません。`)) return;
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`/api/v1/admin/users/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchUsers();
        } catch {
            alert('ユーザーの削除に失敗しました');
        }
    };

    const handleCreateUser = async () => {
        setAddError('');
        if (!newUser.email) { setAddError('メールアドレスは必須です'); return; }
        try {
            const token = localStorage.getItem('token');
            const quotaBytes = (newUser.quota_gb * 1e9).toString();
            await axios.post('/api/v1/admin/users',
                { ...newUser, quota: quotaBytes },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setShowAddForm(false);
            setNewUser({ email: '', account_name: '', password: '', quota_gb: 20 });
            fetchUsers();
        } catch (err: any) {
            setAddError(err.response?.data?.message || 'ユーザー作成に失敗しました');
        }
    };

    const handleBroadcast = async () => {
        setBroadcastStatus({ type: '', message: '' });
        if (!broadcastSubject || !broadcastMessage) {
            setBroadcastStatus({ type: 'error', message: '件名と本文を入力してください' });
            return;
        }
        try {
            const token = localStorage.getItem('token');
            await axios.post('/api/v1/admin/broadcast',
                { subject: broadcastSubject, message: broadcastMessage },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setBroadcastStatus({ type: 'success', message: 'メッセージを一斉送信しました' });
            setTimeout(() => {
                setShowBroadcastForm(false);
                setBroadcastSubject('');
                setBroadcastMessage('');
                setBroadcastStatus({ type: '', message: '' });
            }, 3000);
        } catch (err: any) {
            setBroadcastStatus({ type: 'error', message: err.response?.data?.message || '送信に失敗しました' });
        }
    };

    const calculateYears = (dateString: string) => {
        const createdDate = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - createdDate.getTime());
        const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
        return diffYears.toFixed(1);
    };

    const formatDate = (dateString: string) => {
        const d = new Date(dateString);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    };

    return (
        <AppShell header={{ height: 60 }} padding="md">
            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between">
                    <Title order={3}>Kawamonn Admin</Title>
                    <Group>
                        <Button variant="subtle" onClick={() => navigate('/')}>Storage</Button>
                        <Button variant="light" color="red" onClick={() => {
                            localStorage.clear();
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
                            <Text fw={600} mb="sm">全ユーザーへメッセージを一斉送信</Text>
                            <Stack gap="sm">
                                <TextInput
                                    label="件名"
                                    placeholder="お知らせ：メンテナンスについて"
                                    required
                                    value={broadcastSubject}
                                    onChange={(e) => setBroadcastSubject(e.target.value)}
                                />
                                <TextInput
                                    label="本文"
                                    placeholder="メッセージ内容を入力してください"
                                    required
                                    value={broadcastMessage}
                                    onChange={(e) => setBroadcastMessage(e.target.value)}
                                    size="md"
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
                                    placeholder="空欄の場合は自動生成"
                                    value={newUser.account_name}
                                    onChange={(e) => setNewUser({ ...newUser, account_name: e.target.value })}
                                />
                                <PasswordInput
                                    label="初期パスワード（任意）"
                                    placeholder="空欄の場合はランダム生成"
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                />
                                <NumberInput
                                    label="ストレージ容量 (GB)"
                                    value={newUser.quota_gb}
                                    onChange={(val) => setNewUser({ ...newUser, quota_gb: Number(val) })}
                                    min={1}
                                />
                                {addError && <Text c="red" size="sm">{addError}</Text>}
                                <Button onClick={handleCreateUser}>作成</Button>
                            </Stack>
                        </Card>
                    )}

                    {/* Inline Edit User form */}
                    {editUser && (
                        <Card withBorder shadow="sm" radius="md" p="md" mb="lg" style={{ maxWidth: 360 }}>
                            <Text fw={600} mb="xs">ユーザー編集: {editUser.account_name}</Text>
                            <TextInput
                                label="メールアドレス"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                mb="sm"
                            />
                            <NumberInput
                                label="ストレージ容量 (GB)"
                                value={editQuotaGB}
                                onChange={(val) => setEditQuotaGB(Number(val))}
                                min={1}
                                mb="sm"
                            />
                            <Group gap="xs">
                                <Button size="sm" onClick={handleUpdateUser}>保存</Button>
                                <Button size="sm" variant="subtle" color="gray" onClick={() => setEditUser(null)}>キャンセル</Button>
                            </Group>
                        </Card>
                    )}

                    {error && <Text c="red" mb="md">{error}</Text>}

                    <Divider mb="md" />

                    {/* User table */}
                    <Table striped highlightOnHover withTableBorder withColumnBorders>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>アカウント名</Table.Th>
                                <Table.Th>メール</Table.Th>
                                <Table.Th>ロール</Table.Th>
                                <Table.Th>ストレージ使用量</Table.Th>
                                <Table.Th>初期登録日</Table.Th>
                                <Table.Th>登録からの年数</Table.Th>
                                <Table.Th>操作</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {users.map((user) => (
                                <Table.Tr key={user.id}>
                                    <Table.Td>{user.account_name}</Table.Td>
                                    <Table.Td>{user.email}</Table.Td>
                                    <Table.Td>{user.role}</Table.Td>
                                    <Table.Td>
                                        {(Number(user.used_bytes) / 1e9).toFixed(2)} GB
                                        {' / '}
                                        {(Number(user.quota_bytes) / 1e9).toFixed(2)} GB
                                    </Table.Td>
                                    <Table.Td>{user.created_at ? formatDate(user.created_at) : '-'}</Table.Td>
                                    <Table.Td>{user.created_at ? `${calculateYears(user.created_at)} 年` : '-'}</Table.Td>
                                    <Table.Td>
                                        <Group gap="xs">
                                            <Button
                                                size="xs"
                                                variant="light"
                                                onClick={() => {
                                                    setEditUser(user);
                                                    setEditQuotaGB(Number(user.quota_bytes) / 1e9);
                                                    setEditEmail(user.email);
                                                    setShowAddForm(false);
                                                }}
                                            >
                                                編集
                                            </Button>
                                            <Button
                                                size="xs"
                                                color="red"
                                                variant="light"
                                                onClick={() => handleDeleteUser(user.id, user.account_name)}
                                            >
                                                削除
                                            </Button>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                    {users.length === 0 && !error && (
                        <Text c="dimmed" ta="center" mt="xl">ユーザーが見つかりません</Text>
                    )}
                </Container>
            </AppShell.Main>
        </AppShell>
    );
}
