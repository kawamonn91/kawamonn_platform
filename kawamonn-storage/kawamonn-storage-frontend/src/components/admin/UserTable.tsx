import { Table, Group, Badge, Button, ScrollArea } from '@mantine/core';
import { type AdminUser, formatDate } from '../../api/admin';
import { formatBytes } from '../../api/files';

interface UserTableProps {
    users: AdminUser[];
    currentAccountName: string | null;
    onDetail: (user: AdminUser) => void;
    onEdit: (user: AdminUser) => void;
    onResetPassword: (user: AdminUser) => void;
    onDelete: (user: AdminUser) => void;
}

export function UserTable({
    users,
    currentAccountName,
    onDetail,
    onEdit,
    onResetPassword,
    onDelete,
}: UserTableProps) {
    return (
        <ScrollArea>
            <Table striped highlightOnHover withTableBorder withColumnBorders miw={900}>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>アカウント名</Table.Th>
                        <Table.Th>メール</Table.Th>
                        <Table.Th>ロール</Table.Th>
                        <Table.Th>ストレージ使用量</Table.Th>
                        <Table.Th>登録日</Table.Th>
                        <Table.Th>期限</Table.Th>
                        <Table.Th>操作</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {users.map((user) => (
                        <Table.Tr key={user.id}>
                            <Table.Td>
                                <Group gap={6}>
                                    {user.account_name}
                                    {user.status !== 'active' && <Badge size="xs" color="gray">{user.status}</Badge>}
                                </Group>
                            </Table.Td>
                            <Table.Td>{user.email}</Table.Td>
                            <Table.Td>{user.role}</Table.Td>
                            <Table.Td>
                                {formatBytes(Number(user.used_bytes))} / {formatBytes(Number(user.quota_bytes))}
                            </Table.Td>
                            <Table.Td>{formatDate(user.created_at)}</Table.Td>
                            <Table.Td>{formatDate(user.expiry_at)}</Table.Td>
                            <Table.Td>
                                <Group gap="xs" wrap="nowrap">
                                    <Button size="xs" variant="default" onClick={() => onDetail(user)}>
                                        詳細
                                    </Button>
                                    <Button size="xs" variant="light" onClick={() => onEdit(user)}>
                                        編集
                                    </Button>
                                    <Button size="xs" variant="light" color="orange" onClick={() => onResetPassword(user)}>
                                        仮パスワード
                                    </Button>
                                    <Button
                                        size="xs"
                                        color="red"
                                        variant="light"
                                        disabled={user.account_name === currentAccountName}
                                        title={user.account_name === currentAccountName ? '自分自身は削除できません' : undefined}
                                        onClick={() => onDelete(user)}
                                    >
                                        削除
                                    </Button>
                                </Group>
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </ScrollArea>
    );
}
