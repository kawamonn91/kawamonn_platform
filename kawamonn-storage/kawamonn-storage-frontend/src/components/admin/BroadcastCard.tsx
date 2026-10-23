import { useState } from 'react';
import { Card, Stack, TextInput, Textarea, Text, Button } from '@mantine/core';
import { sendAdminBroadcast } from '../../api/admin';
import { getErrorMessage } from '../../api/client';

interface BroadcastCardProps {
    onClose: () => void;
}

export function BroadcastCard({ onClose }: BroadcastCardProps) {
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState({ type: '', message: '' });
    const [loading, setLoading] = useState(false);

    const handleBroadcast = async () => {
        setStatus({ type: '', message: '' });
        if (!subject.trim() || !message.trim()) {
            setStatus({ type: 'error', message: '件名と本文を入力してください' });
            return;
        }
        if (!window.confirm('有効な利用者全員にメールを送ります。よろしいですか？')) return;

        setLoading(true);
        try {
            const res = await sendAdminBroadcast(subject.trim(), message.trim());
            setStatus({ type: 'success', message: `${res.recipientCount ?? 0} 人に送信しました` });
            setTimeout(() => {
                onClose();
            }, 3000);
        } catch (err) {
            setStatus({ type: 'error', message: getErrorMessage(err, '送信に失敗しました') });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card withBorder shadow="sm" radius="md" p="md" mb="lg" style={{ maxWidth: 600 }}>
            <Text fw={600} mb="sm">有効な利用者全員へメッセージを一斉送信</Text>
            <Stack gap="sm">
                <TextInput
                    label="件名"
                    placeholder="お知らせ：メンテナンスについて"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                />
                <Textarea
                    label="本文"
                    placeholder="メッセージ内容を入力してください"
                    required
                    autosize
                    minRows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                />
                {status.message && (
                    <Text c={status.type === 'error' ? 'red' : 'green'} size="sm">
                        {status.message}
                    </Text>
                )}
                <Button onClick={handleBroadcast} loading={loading}>送信する</Button>
            </Stack>
        </Card>
    );
}
