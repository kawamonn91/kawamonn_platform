import { useState } from 'react';
import { PasswordInput, Button, Paper, Title, Container, Text, Alert, Stack } from '@mantine/core';
import { useSearchParams, Link } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!token) {
            setStatus('error');
            setMessage('再設定トークンが無効または不足しています。');
            return;
        }

        if (password !== confirmPassword) {
            setStatus('error');
            setMessage('パスワードが一致しません。');
            return;
        }

        if (password.length < 8) {
            setStatus('error');
            setMessage('パスワードは8文字以上で入力してください。');
            return;
        }

        try {
            setStatus('loading');
            setMessage('');
            await api.post('/api/v1/auth/reset-password', { token, new_password: password });
            setStatus('success');
            setMessage('パスワードを再設定しました。');
        } catch (err) {
            setStatus('error');
            setMessage(getErrorMessage(err, 'パスワードの再設定に失敗しました。リンクの有効期限が切れている可能性があります。'));
        }
    };

    if (!token) {
        return (
            <Container size={400} my={64}>
                <Alert icon={<IconAlertCircle size={16} />} title="無効なリンク" color="red">
                    このパスワード再設定リンクは無効です。
                    <Button fullWidth mt="md" component={Link} to="/forgot-password" variant="default">
                        再設定リンクをもう一度リクエストする
                    </Button>
                </Alert>
            </Container>
        );
    }

    return (
        <Container size={400} my={64}>
            <Title order={3} fw={700} mb={4} style={{ letterSpacing: '-0.02em' }}>
                新しいパスワードの設定
            </Title>
            <Text c="dimmed" size="xs" mb="lg">
                8文字以上の新しいパスワードを入力してください
            </Text>

            <Paper withBorder p={24}>
                {status === 'success' ? (
                    <Alert icon={<IconCheck size={16} />} title="完了" color="green">
                        {message}
                        <Button fullWidth mt="md" component={Link} to="/login" color="gray.1" c="dark.9">
                            ログイン画面へ
                        </Button>
                    </Alert>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {status === 'error' && (
                            <Alert icon={<IconAlertCircle size={16} />} title="エラー" color="red" mb="md">
                                {message}
                            </Alert>
                        )}
                        <Stack>
                            <PasswordInput
                                label="新しいパスワード"
                                placeholder="8文字以上"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <PasswordInput
                                label="新しいパスワード（確認）"
                                placeholder="もう一度入力"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <Button fullWidth mt="md" type="submit" loading={status === 'loading'} color="gray.1" c="dark.9">
                                パスワードを更新する
                            </Button>
                        </Stack>
                    </form>
                )}
            </Paper>
        </Container>
    );
}
