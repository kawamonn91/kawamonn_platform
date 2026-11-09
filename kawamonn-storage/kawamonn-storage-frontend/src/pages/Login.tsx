import { useState } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Text, Group } from '@mantine/core';
import { useNavigate, Link } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';

export default function Login() {
    const [accountName, setAccountName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { login } = useAuth();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await api.post('/api/v1/auth/login', { account_name: accountName, password });

            // Update auth context state first, then navigate
            login(res.data.token);
            navigate('/');
        } catch (err) {
            setError(getErrorMessage(err, 'ログインに失敗しました'));
        }
    };

    return (
        <Container size={400} my={64}>
            <Group justify="space-between" align="baseline" mb={4}>
                <Title order={3} fw={700} style={{ letterSpacing: '-0.02em' }}>Kawamonn Storage</Title>
                <Text size="xs" c="dimmed" ff="monospace">storage.kawamonn.com</Text>
            </Group>
            <Text c="dimmed" size="xs" mb="lg">
                会津大学生専用オンラインストレージ・SSH端末
            </Text>

            <Paper withBorder p={24}>
                <Title order={4} mb="md">ログイン</Title>
                <form onSubmit={handleLogin}>
                    <TextInput
                        label="アカウント名"
                        placeholder="登録したユーザー名"
                        required
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                    />
                    <PasswordInput
                        label="パスワード"
                        placeholder="パスワード"
                        required
                        mt="md"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <Group justify="flex-end" mt="xs">
                        <Link to="/forgot-password" style={{ fontSize: '12px', color: '#a1a1aa' }}>
                            パスワードを忘れた場合
                        </Link>
                    </Group>

                    {error && <Text c="red" size="sm" mt="sm">{error}</Text>}

                    <Button fullWidth mt="lg" type="submit" color="gray.1" c="dark.9">
                        ログイン
                    </Button>
                </form>

                <Text c="dimmed" size="xs" ta="center" mt="lg">
                    アカウントをお持ちでない場合は <Link to="/register">新規登録</Link>
                </Text>
            </Paper>
        </Container>
    );
}
