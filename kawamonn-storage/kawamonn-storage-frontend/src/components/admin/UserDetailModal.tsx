import { Modal, Stack, Table, Text, ScrollArea, Group, Loader } from '@mantine/core';
import { type AdminUserDetail, formatDate, formatDateTime, ACTION_LABELS } from '../../api/admin';
import { formatBytes } from '../../api/files';

interface UserDetailModalProps {
    detail: AdminUserDetail | null;
    loading: boolean;
    onClose: () => void;
}

export function UserDetailModal({ detail, loading, onClose }: UserDetailModalProps) {
    return (
        <Modal
            opened={loading || detail !== null}
            onClose={onClose}
            title={detail ? `ユーザーの詳細: ${detail.account_name}` : 'ユーザーの詳細'}
            size="xl"
        >
            {loading || !detail ? (
                <Group justify="center" py="xl"><Loader size="sm" /></Group>
            ) : (
                <Stack gap="md">
                    <Table withTableBorder>
                        <Table.Tbody>
                            {[
                                ['メール', detail.email],
                                ['ロール / 状態', `${detail.role} / ${detail.status}`],
                                ['ストレージ', `${formatBytes(Number(detail.used_bytes))} / ${formatBytes(Number(detail.quota_bytes))}`],
                                ['登録日', formatDate(detail.created_at)],
                                ['期限', formatDate(detail.expiry_at)],
                                ['パスワードを設定した日', formatDate(detail.password_last_set_at)],
                                ['期限のお知らせを送った日', formatDate(detail.last_reminder_sent)],
                            ].map(([label, value]) => (
                                <Table.Tr key={label}>
                                    <Table.Th w={200}>{label}</Table.Th>
                                    <Table.Td>{value}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                    <Text fw={600}>操作の記録（新しい順に50件まで）</Text>
                    {detail.audit_logs.length === 0 ? (
                        <Text size="sm" c="dimmed">記録はありません</Text>
                    ) : (
                        <ScrollArea h={300}>
                            <Table striped>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>日時</Table.Th>
                                        <Table.Th>操作</Table.Th>
                                        <Table.Th>内容</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {detail.audit_logs.map((log) => (
                                        <Table.Tr key={log.id}>
                                            <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</Table.Td>
                                            <Table.Td>{ACTION_LABELS[log.action] ?? log.action}</Table.Td>
                                            <Table.Td>
                                                <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                                                    {log.metadata ? JSON.stringify(log.metadata) : ''}
                                                </Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </ScrollArea>
                    )}
                </Stack>
            )}
        </Modal>
    );
}
