import { ActionIcon, Card, Grid, Group, Menu, Text } from '@mantine/core';
import { IconDotsVertical, IconEdit, IconFolder, IconTrash } from '@tabler/icons-react';
import { type StorageEntry } from '../api/storage';

export interface FolderCardProps {
    entry: StorageEntry;
    onOpen: (entry: StorageEntry) => void;
    onDelete: (entry: StorageEntry) => void;
    onRename?: (entry: StorageEntry) => void;
}

export default function FolderCard({ entry, onOpen, onDelete, onRename }: FolderCardProps) {
    return (
        <Grid.Col span={{ base: 12, sm: 6, md: 4, lg: 3 }}>
            <Card
                shadow="xs"
                padding="sm"
                radius="md"
                withBorder
                style={{ cursor: 'pointer', transition: 'background-color 0.2s ease' }}
                onClick={() => onOpen(entry)}
                className="folder-card"
            >
                <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ overflow: 'hidden' }}>
                        <IconFolder size={24} color="#4dabf7" style={{ flexShrink: 0 }} />
                        <Text fw={500} size="sm" truncate>
                            {entry.name}
                        </Text>
                    </Group>
                    <Menu shadow="md" width={140} position="bottom-end" withinPortal>
                        <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" onClick={(e) => e.stopPropagation()}>
                                <IconDotsVertical size={16} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            {onRename && (
                                <Menu.Item
                                    leftSection={<IconEdit size={14} />}
                                    onClick={(e) => { e.stopPropagation(); onRename(entry); }}
                                >
                                    名前の変更
                                </Menu.Item>
                            )}
                            <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={14} />}
                                onClick={(e) => { e.stopPropagation(); onDelete(entry); }}
                            >
                                削除
                            </Menu.Item>
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Card>
        </Grid.Col>
    );
}
