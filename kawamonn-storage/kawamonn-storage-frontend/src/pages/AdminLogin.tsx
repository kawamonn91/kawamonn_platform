import { useState } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Text, Group } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';
import { BrandLockup } from '../components/Brand';

export default function AdminLogin() {
    const [accountName, setAccountName] = useState('');
    const [password, setPassword] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [step, setStep] = useState(1);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const navigate = useNavigate();
    const { login } = useAuth();

    const handleAdminLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/api/v1/auth/admin/login', { account_name: accountName, password });
            setSuccessMsg('認証情報を確認しました。管理者メールへ送信された6桁の確認コードを入力してください。');
            setStep(2);
        } catch (err) {
            setError(getErrorMessage(err, '管理者ログインに失敗しました'));
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const res = await api.post('/api/v1/auth/admin/verify', {
                account_name: accountName,
                otp_code: otpCode
            });
            login(res.data.token);
            navigate('/admin');

        } catch (err) {
            setError(getErrorMessage(err, '確認コードの検証に失敗しました'));
        }
    };

    return (
        <Container size={400} my={64}>
            <Group mb="xl"><BrandLockup section="管理" /></Group>
            <Group justify="space-between" align="baseline" mb={4}>
                <Title order={3} fw={700}>管理者コンソール</Title>
                <Text size="xs" c="dimmed" ff="monospace">ADMIN</Text>
            </Group>
            <Text c="dimmed" size="xs" mb="lg">
                ストレージの管理用ログイン
            </Text>
            <Paper withBorder p={24}>
                {step === 1 ? (
                    <form onSubmit={handleAdminLogin}>
                        <TextInput
                            label="管理者アカウント名"
                            placeholder="管理者ID"
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
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="lg" type="submit">
                            確認コードを送信
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleVerify}>
                        <Text fw={500} size="xs" mb="md" c="dimmed">{successMsg}</Text>
                        <TextInput
                            label="管理者確認コード (OTP)"
                            placeholder="6桁のコード"
                            required
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                        />
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="lg" type="submit">
                            認証してログイン
                        </Button>
                        <Button fullWidth mt="xs" variant="subtle" color="gray" onClick={() => setStep(1)}>
                            戻る
                        </Button>
                    </form>
                )}
            </Paper>
        </Container>
    );
}
