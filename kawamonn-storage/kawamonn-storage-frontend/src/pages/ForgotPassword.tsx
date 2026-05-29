import { useState } from 'react';
import { TextInput, Button, Paper, Title, Container, Text, Alert, Group, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import axios from 'axios';
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
            await axios.post('/api/v1/auth/forgot-password', { email });
            setStatus('success');
            setMessage('If an account matches that email, a password reset link has been sent. Please check your inbox.');
        } catch (err: any) {
            setStatus('error');
            setMessage(err.response?.data?.message || 'Failed to process request');
        }
    };

    return (
        <Container size={420} my={80}>
            <Title ta="center" className="mantine-Title-root">
                Forgot your password?
            </Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Enter your email to get a reset link
            </Text>

            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                {status === 'success' ? (
                    <Alert icon={<IconCheck size={16} />} title="Check your email" color="green">
                        {message}
                        <Button fullWidth mt="xl" component={Link} to="/login" variant="outline">
                            Back to login
                        </Button>
                    </Alert>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {status === 'error' && (
                            <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" mb="md">
                                {message}
                            </Alert>
                        )}
                        <TextInput
                            label="Email"
                            placeholder="you@example.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <Group justify="space-between" mt="lg">
                            <Anchor component={Link} to="/login" c="dimmed" size="sm">
                                Back to login
                            </Anchor>
                            <Button type="submit" loading={status === 'loading'}>
                                Send reset link
                            </Button>
                        </Group>
                    </form>
                )}
            </Paper>
        </Container>
    );
}
