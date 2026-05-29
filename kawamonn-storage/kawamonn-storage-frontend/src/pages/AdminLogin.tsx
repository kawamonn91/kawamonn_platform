import { useState } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Text } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../App';

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
            await axios.post('/api/v1/auth/admin/login', { account_name: accountName, password });
            setSuccessMsg('Admin credentials verified. OTP sent to kawamonn91@gmail.com.');
            setStep(2);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Admin login failed');
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const res = await axios.post('/api/v1/auth/admin/verify', {
                account_name: accountName,
                otp_code: otpCode
            });
            const token = res.data.token;
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(window.atob(base64));

            // Update auth context state, then navigate (no full reload needed)
            login(token, payload.role, payload.account_name);
            navigate('/admin');

        } catch (err: any) {
            setError(err.response?.data?.message || 'Verification failed');
        }
    };

    return (
        <Container size={420} my={40}>
            <Title ta="center" c="red">Restricted Admin Portal</Title>
            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                {step === 1 ? (
                    <form onSubmit={handleAdminLogin}>
                        <TextInput
                            label="Admin Username"
                            placeholder="Superuser ID"
                            required
                            value={accountName}
                            onChange={(e) => setAccountName(e.target.value)}
                        />
                        <PasswordInput
                            label="Password"
                            placeholder="Your password"
                            required
                            mt="md"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="xl" color="red" type="submit">
                            Request Admin Access
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleVerify}>
                        <Text fw={500} size="sm" mb="md" c="blue">{successMsg}</Text>
                        <TextInput
                            label="Admin Security OTP"
                            placeholder="6-digit code"
                            required
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                        />
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="xl" color="red" type="submit">
                            Verify and Login
                        </Button>
                        <Button fullWidth mt="sm" variant="subtle" onClick={() => setStep(1)}>
                            Back
                        </Button>
                    </form>
                )}
            </Paper>
        </Container>
    );
}
