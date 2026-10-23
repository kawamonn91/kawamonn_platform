import { useState, useEffect } from 'react';
import { Modal, Stack, TextInput, NumberInput, Text, Group, Button } from '@mantine/core';
import { type AdminUser, updateAdminUserEmail, updateAdminUserQuota, GIB } from '../../api/admin';
import { getErrorMessage } from '../../api/client';

interface UserEditModalProps {
    user: AdminUser | null;
    onClose: () => void;
    onSaved: () => void;
}

export function UserEditModal({ user, onClose, onSaved }: UserEditModalProps) {
    const [email, setEmail] = useState('');
    const [quotaGB, setQuotaGB] = useState(20);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (user) {
            setEmail(user.email);
            setQuotaGB(Math.round(Number(user.quota_bytes) / GIB));
            setError('');
        }
    }, [user]);

    const handleSave = async () => {
        if (!user) return;
        setError('');
        setLoading(true);
        try {
            if (email !== user.email) {
                await updateAdminUserEmail(user.id, email);
            }
            if (quotaGB * GIB !== Number(user.quota_bytes)) {
                await updateAdminUserQuota(user.id, quotaGB);
            }
            onSaved();
        } catch (err) {
            setError(getErrorMessage(err, 'ユーザー情報の更新に失敗しました'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal opened={user !== null} onClose={onClose} title={`ユーザー編集: ${user?.account_name ?? ''}`}>
            <Stack gap="sm">
                <TextInput
                    label="メールアドレス"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <NumberInput
                    label="ストレージ容量 (GB)"
                    value={quotaGB}
                    onChange={(val) => setQuotaGB(Number(val))}
                    min={1}
                    allowDecimal={false}
                />
                {error && <Text c="red" size="sm">{error}</Text>}
                <Group gap="xs" justify="flex-end">
                    <Button variant="subtle" color="gray" onClick={onClose} disabled={loading}>キャンセル</Button>
                    <Button onClick={handleSave} loading={loading}>保存</Button>
                </Group>
            </Stack>
        </Modal>
    );
}
