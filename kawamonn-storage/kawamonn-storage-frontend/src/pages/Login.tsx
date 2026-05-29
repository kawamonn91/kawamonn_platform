import { useState } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Text, Group } from '@mantine/core';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../App';

export default function Login() {
    const [accountName, setAccountName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { login } = useAuth();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/v1/auth/login', { account_name: accountName, password });

            const token = res.data.token;
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            const decoded = JSON.parse(jsonPayload);

            // Update auth context state first, then navigate
            login(token, decoded.role, decoded.account_name);
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Login failed');
        }
    };

    return (
        <Container size={420} my={40}>
            <Title ta="center">UoA Online</Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Do not have an account yet?{' '}
                <Link to="/register">Create account</Link>
            </Text>

            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                <form onSubmit={handleLogin}>
                    <TextInput
                        label="Account Name"
                        placeholder="Your account name"
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
                    <Group justify="flex-end" mt="xs">
                        <Link to="/forgot-password" style={{ fontSize: '12px', color: '#1c7ed6', textDecoration: 'none' }}>Forgot password?</Link>
                    </Group>

                    {error && <Text c="red" size="sm" mt="sm">{error}</Text>}

                    <Button fullWidth mt="xl" type="submit">
                        Sign in
                    </Button>
                </form>
            </Paper>
        </Container>
    );
}
