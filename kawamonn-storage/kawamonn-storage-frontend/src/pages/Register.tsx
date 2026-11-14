import { useState } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Text, Group } from '@mantine/core';
import { useNavigate, Link } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { BrandLockup } from '../components/Brand';

export default function Register() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [step, setStep] = useState(1);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const navigate = useNavigate();

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/api/v1/auth/send-otp', { email });
            setSuccessMsg('確認コードをメールで送信しました。受信トレイを確認してください。');
            setStep(2);
        } catch (err) {
            setError(getErrorMessage(err, '確認コードの送信に失敗しました'));
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/api/v1/auth/register', {
                email,
                password,
                display_name: displayName,
                otp_code: otpCode
            });
            navigate('/login');
        } catch (err) {
            setError(getErrorMessage(err, 'アカウント登録に失敗しました'));
        }
    };

    return (
        <Container size={400} my={64}>
            <Group mb="xl"><BrandLockup /></Group>
            <Group justify="space-between" align="baseline" mb={4}>
                <Title order={3} fw={700}>新規アカウント登録</Title>
                <Text size="xs" c="dimmed" ff="monospace">@u-aizu.ac.jp</Text>
            </Group>
            <Text c="dimmed" size="xs" mb="lg">
                会津大学のメールアドレス（@u-aizu.ac.jp）が必要です
            </Text>

            <Paper withBorder p={24}>
                {step === 1 ? (
                    <form onSubmit={handleSendOtp}>
                        <TextInput
                            label="大学メールアドレス"
                            placeholder="s1234567@u-aizu.ac.jp"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <TextInput
                            label="アカウント名（ユーザー名）"
                            placeholder="半角英数字・_ . -"
                            required
                            mt="md"
                            value={displayName}
                            error={displayName && !/^[a-zA-Z0-9_.-]+$/.test(displayName) ? '半角英数字と _ . - のみ使用できます' : null}
                            onChange={(e) => setDisplayName(e.target.value)}
                        />
                        <PasswordInput
                            label="パスワード"
                            placeholder="8文字以上"
                            required
                            mt="md"
                            value={password}
                            error={password && password.length < 8 ? 'パスワードは8文字以上で入力してください' : null}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="lg" type="submit">
                            確認コードを送信
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleRegister}>
                        <Text fw={500} size="xs" mb="md" c="dimmed">{successMsg}</Text>
                        <TextInput
                            label="確認コード (OTP)"
                            placeholder="メールに届いた6桁のコード"
                            required
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                        />
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="lg" type="submit">
                            登録を完了する
                        </Button>
                        <Button fullWidth mt="xs" variant="subtle" color="gray" onClick={() => setStep(1)}>
                            戻る
                        </Button>
                    </form>
                )}
                <Text c="dimmed" size="xs" ta="center" mt="lg">
                    <Link to="/login">ログイン画面へ戻る</Link>
                </Text>
            </Paper>
        </Container>
    );
}
