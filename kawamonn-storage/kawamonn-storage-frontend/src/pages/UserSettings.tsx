import { useState, useEffect } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text,
    TextInput, PasswordInput, Card, Stack, Divider, Alert
} from '@mantine/core';
import { IconArrowLeft, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../App';

export default function UserSettings() {
    const navigate = useNavigate();
    const { logout } = useAuth();
    const [accountName, setAccountName] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [passMsg, setPassMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const fetchMe = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get('/api/v1/users/me', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setAccountName(res.data.account_name);
            } catch {
                navigate('/login');
            }
        };
        fetchMe();
    }, []);

    const handleUpdateProfile = async () => {
        setProfileMsg(null);
        try {
            const token = localStorage.getItem('token');
            await axios.put('/api/v1/users/me',
                { account_name: accountName },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            // Update stored account_name
            localStorage.setItem('account_name', accountName);
            setProfileMsg({ type: 'success', text: 'アカウント名を更新しました' });
        } catch (err: any) {
            setProfileMsg({ type: 'error', text: err.response?.data?.message || '更新に失敗しました' });
        }
    };

    const handleUpdatePassword = async () => {
        setPassMsg(null);
        if (newPassword !== confirmPassword) {
            setPassMsg({ type: 'error', text: '新しいパスワードが一致しません' });
            return;
        }
        if (newPassword.length < 8) {
            setPassMsg({ type: 'error', text: 'パスワードは8文字以上が必要です' });
            return;
        }
        try {
            const token = localStorage.getItem('token');
            await axios.put('/api/v1/users/me',
                { current_password: currentPassword, new_password: newPassword },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setPassMsg({ type: 'success', text: 'パスワードを更新しました' });
        } catch (err: any) {
            setPassMsg({ type: 'error', text: err.response?.data?.message || 'パスワード変更に失敗しました' });
        }
    };

    const handleDeleteAccount = async () => {
        if (!window.confirm('本当にアカウントを削除しますか？\n全てのデータが削除され、この操作は取り消せません。')) {
            return;
        }
        try {
            const token = localStorage.getItem('token');
            await axios.delete('/api/v1/users/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            logout();
            navigate('/login');
        } catch (err: any) {
            alert(err.response?.data?.message || 'アカウント削除に失敗しました');
        }
    };


    return (
        <AppShell header={{ height: 60 }} padding="md">
            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between">
                    <Group gap="sm">
                        <Button
                            variant="subtle"
                            leftSection={<IconArrowLeft size={16} />}
                            onClick={() => navigate('/')}
                        >
                            戻る
                        </Button>
                        <Title order={3}>アカウント設定</Title>
                    </Group>
                    <Button
                        variant="light"
                        color="red"
                        size="sm"
                        onClick={() => { logout(); navigate('/login'); }}
                    >
                        Logout
                    </Button>
                </Group>
            </AppShell.Header>

            <AppShell.Main>
                <Container size="sm">
                    {/* Account Name Card */}
                    <Card withBorder shadow="sm" radius="md" p="lg" mb="lg">
                        <Title order={4} mb="md">ユーザー名の変更</Title>
                        <Stack gap="sm">
                            <TextInput
                                label="アカウント名"
                                value={accountName}
                                error={accountName && !/^[a-zA-Z0-9_.-]+$/.test(accountName) ? 'アルファベット、数字、_ . - のみ使用できます' : null}
                                onChange={(e) => setAccountName(e.target.value)}
                                placeholder="新しいアカウント名"
                            />
                            {profileMsg && (
                                <Alert
                                    color={profileMsg.type === 'success' ? 'green' : 'red'}
                                    icon={profileMsg.type === 'success' ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
                                >
                                    {profileMsg.text}
                                </Alert>
                            )}
                            <Button onClick={handleUpdateProfile}>
                                ユーザー名を更新
                            </Button>
                        </Stack>
                    </Card>

                    <Divider my="lg" />

                    {/* Password Card */}
                    <Card withBorder shadow="sm" radius="md" p="lg">
                        <Title order={4} mb="md">パスワードの変更</Title>
                        <Stack gap="sm">
                            <PasswordInput
                                label="現在のパスワード"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                placeholder="現在のパスワードを入力"
                            />
                            <PasswordInput
                                label="新しいパスワード"
                                value={newPassword}
                                error={newPassword && !/^[a-zA-Z0-9_.-]+$/.test(newPassword) ? 'アルファベット、数字、_ . - のみ使用できます' : null}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="8文字以上"
                            />
                            <PasswordInput
                                label="新しいパスワード（確認）"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="もう一度入力"
                            />
                            {passMsg && (
                                <Alert
                                    color={passMsg.type === 'success' ? 'green' : 'red'}
                                    icon={passMsg.type === 'success' ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
                                >
                                    {passMsg.text}
                                </Alert>
                            )}
                            <Button onClick={handleUpdatePassword}>
                                パスワードを変更
                            </Button>
                        </Stack>
                    </Card>

                    <Divider my="lg" />

                    {/* Danger Zone: Account Deletion */}
                    <Card withBorder shadow="sm" radius="md" p="lg" style={{ borderColor: '#fa5252' }}>
                        <Title order={4} mb="md" c="red">Danger Zone</Title>
                        <Stack gap="sm">
                            <Text size="sm" c="dimmed">
                                アカウントを削除すると、設定やデータはすべて消去され、復元することはできません。
                            </Text>
                            <Button color="red" variant="outline" onClick={handleDeleteAccount}>
                                アカウントを削除する
                            </Button>
                        </Stack>
                    </Card>

                    <Text c="dimmed" size="xs" ta="center" mt="lg">
                        {localStorage.getItem('account_name') || ''} · {localStorage.getItem('role') || 'user'}
                    </Text>
                </Container>
            </AppShell.Main>
        </AppShell>
    );
}
