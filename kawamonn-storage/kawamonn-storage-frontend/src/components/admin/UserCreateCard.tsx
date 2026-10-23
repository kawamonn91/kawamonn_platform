import { useState } from 'react';
import { Card, Stack, TextInput, PasswordInput, NumberInput, Text, Button } from '@mantine/core';
import { createAdminUser, type CreateUserPayload } from '../../api/admin';
import { getErrorMessage } from '../../api/client';

interface UserCreateCardProps {
    onCreated: (createdUser: { account_name: string; temporary_password?: string }) => void;
}

export function UserCreateCard({ onCreated }: UserCreateCardProps) {
    const [newUser, setNewUser] = useState<CreateUserPayload>({
        email: '',
        account_name: '',
        password: '',
        quota_gb: 20,
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleCreateUser = async () => {
        setError('');
        if (!newUser.email.trim()) {
            setError('メールアドレスは必須です');
            return;
        }

        setLoading(true);
        try {
            const res = await createAdminUser(newUser);
            onCreated({
                account_name: res.account_name,
                temporary_password: res.temporary_password,
            });
            setNewUser({ email: '', account_name: '', password: '', quota_gb: 20 });
        } catch (err) {
            setError(getErrorMessage(err, 'ユーザー作成に失敗しました'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card withBorder shadow="sm" radius="md" p="md" mb="lg" style={{ maxWidth: 480 }}>
            <Text fw={600} mb="sm">例外ユーザーを追加</Text>
            <Stack gap="sm">
                <TextInput
                    label="メールアドレス"
                    placeholder="user@example.com"
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
                <TextInput
                    label="アカウント名（任意）"
                    placeholder="空欄の場合はメールアドレスの @ の前"
                    value={newUser.account_name}
                    onChange={(e) => setNewUser({ ...newUser, account_name: e.target.value })}
                />
                <PasswordInput
                    label="初期パスワード（任意）"
                    placeholder="空欄の場合は仮パスワードを作って表示"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
                <NumberInput
                    label="ストレージ容量 (GB)"
                    value={newUser.quota_gb}
                    onChange={(val) => setNewUser({ ...newUser, quota_gb: Number(val) })}
                    min={1}
                    allowDecimal={false}
                />
                {error && <Text c="red" size="sm">{error}</Text>}
                <Button onClick={handleCreateUser} loading={loading}>作成</Button>
            </Stack>
        </Card>
    );
}
