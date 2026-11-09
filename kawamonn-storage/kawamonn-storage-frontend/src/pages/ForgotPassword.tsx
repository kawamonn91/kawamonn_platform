import { useState } from 'react';
import { TextInput, Button, Paper, Title, Container, Text, Alert, Group, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setStatus('loading');
            setMessage('');
            await api.post('/api/v1/auth/forgot-password', { email });
            setStatus('success');
            setMessage('該当するアカウントが存在する場合、パスワード再設定用のリンクをメールで送信しました。');
        } catch (err) {
            setStatus('error');
            setMessage(getErrorMessage(err, 'リクエストの処理に失敗しました'));
        }
    };

    return (
        <Container size={400} my={64}>
            <Title order={3} fw={700} mb={4} style={{ letterSpacing: '-0.02em' }}>
                パスワードの再設定
            </Title>
            <Text c="dimmed" size="xs" mb="lg">
                登録済みのメールアドレスに再設定リンクを送信します
            </Text>

            <Paper withBorder p={24}>
                {status === 'success' ? (
                    <Alert icon={<IconCheck size={16} />} title="送信完了" color="green">
                        {message}
                        <Button fullWidth mt="md" component={Link} to="/login" variant="default">
                            ログイン画面へ戻る
                        </Button>
                    </Alert>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {status === 'error' && (
                            <Alert icon={<IconAlertCircle size={16} />} title="エラー" color="red" mb="md">
                                {message}
                            </Alert>
                        )}
                        <TextInput
                            label="メールアドレス"
                            placeholder="s1234567@u-aizu.ac.jp"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <Group justify="space-between" mt="lg">
                            <Anchor component={Link} to="/login" c="dimmed" size="xs">
                                ログイン画面へ戻る
                            </Anchor>
                            <Button type="submit" loading={status === 'loading'} color="gray.1" c="dark.9">
                                再設定リンクを送信
                            </Button>
                        </Group>
                    </form>
                )}
            </Paper>
        </Container>
    );
}
