import { useState } from 'react';
import { PasswordInput, Button, Paper, Title, Container, Text, Alert, Stack } from '@mantine/core';
import { useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
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
            setMessage('Invalid or missing reset token.');
            return;
        }

        if (password !== confirmPassword) {
            setStatus('error');
            setMessage('Passwords do not match.');
            return;
        }

        if (password.length < 8) {
            setStatus('error');
            setMessage('Password must be at least 8 characters long.');
            return;
        }

        try {
            setStatus('loading');
            setMessage('');
            await axios.post('/api/v1/auth/h1_JMT48RY-eJkeeVQwib5gvOwRFWNYswkOzBofQ', { token, new_password: password });
            setStatus('success');
            setMessage('Your password has been reset successfully.');
        } catch (err: any) {
            setStatus('error');
            setMessage(err.response?.data?.message || 'Failed to reset password. The link might be expired.');
        }
    };

    if (!token) {
        return (
            <Container size={420} my={80}>
                <Alert icon={<IconAlertCircle size={16} />} title="Invalid Link" color="red">
                    This password reset link is invalid or missing the token.
                    <Button fullWidth mt="xl" component={Link} to="/forgot-password" variant="outline">
                        Request new link
                    </Button>
                </Alert>
            </Container>
        );
    }

    return (
        <Container size={420} my={80}>
            <Title ta="center">
                Create new password
            </Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Enter your new secure password below
            </Text>

            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                {status === 'success' ? (
                    <Alert icon={<IconCheck size={16} />} title="Success" color="green">
                        {message}
                        <Button fullWidth mt="xl" component={Link} to="/login" variant="filled">
                            Go to login
                        </Button>
                    </Alert>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {status === 'error' && (
                            <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" mb="md">
                                {message}
                            </Alert>
                        )}
                        <Stack>
                            <PasswordInput
                                label="New Password"
                                placeholder="8+ characters"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <PasswordInput
                                label="Confirm Password"
                                placeholder="Confirm new password"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <Button fullWidth mt="xl" type="submit" loading={status === 'loading'}>
                                Reset password
                            </Button>
                        </Stack>
                    </form>
                )}
            </Paper>
        </Container>
    );
}
