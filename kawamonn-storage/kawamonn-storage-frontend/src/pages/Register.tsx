import { useState } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Text } from '@mantine/core';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

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
            await axios.post('/api/v1/auth/send-otp', { email });
            setSuccessMsg('OTP sent to your email! Please check your inbox.');
            setStep(2);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to send OTP');
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            await axios.post('/api/v1/auth/register', {
                email,
                password,
                display_name: displayName,
                otp_code: otpCode
            });
            navigate('/login');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Registration failed');
        }
    };

    return (
        <Container size={420} my={40}>
            <Title ta="center">Create an Account</Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Must be a @u-aizu.ac.jp domain
            </Text>

            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                {step === 1 ? (
                    <form onSubmit={handleSendOtp}>
                        <TextInput
                            label="Email"
                            placeholder="s1234567@u-aizu.ac.jp"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <TextInput
                            label="Username"
                            placeholder="Your username"
                            required
                            mt="md"
                            value={displayName}
                            error={displayName && !/^[a-zA-Z0-9_.-]+$/.test(displayName) ? 'Username can only contain letters, numbers, and _ . -' : null}
                            onChange={(e) => setDisplayName(e.target.value)}
                        />
                        <PasswordInput
                            label="Password"
                            placeholder="Your password"
                            required
                            mt="md"
                            value={password}
                            error={password && !/^[a-zA-Z0-9_.-]+$/.test(password) ? 'Password can only contain letters, numbers, and _ . -' : null}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="xl" type="submit">
                            Send Verification Code
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleRegister}>
                        <Text fw={500} size="sm" mb="md" c="blue">{successMsg}</Text>
                        <TextInput
                            label="Verification Code (OTP)"
                            placeholder="6-digit code from your email"
                            required
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                        />
                        {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
                        <Button fullWidth mt="xl" type="submit">
                            Complete Registration
                        </Button>
                        <Button fullWidth mt="sm" variant="subtle" onClick={() => setStep(1)}>
                            Back
                        </Button>
                    </form>
                )}
                <Text c="dimmed" size="sm" ta="center" mt="md">
                    <Link to="/login">Back to Login</Link>
                </Text>
            </Paper>
        </Container>
    );
}
