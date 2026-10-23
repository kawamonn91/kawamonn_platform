import { useState, useEffect } from 'react';
import { Modal, Stack, TextInput, Text, Group, Button } from '@mantine/core';

export interface ConfirmModalProps {
    opened: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    confirmColor?: string;
    onConfirm: () => void;
    onClose: () => void;
}

export function ConfirmModal({
    opened,
    title,
    message,
    confirmLabel = 'OK',
    confirmColor = 'red',
    onConfirm,
    onClose,
}: ConfirmModalProps) {
    return (
        <Modal opened={opened} onClose={onClose} title={title} size="sm">
            <Stack gap="md">
                <Text size="sm" style={{ whiteSpace: 'pre-line' }}>{message}</Text>
                <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={onClose}>キャンセル</Button>
                    <Button color={confirmColor} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
                </Group>
            </Stack>
        </Modal>
    );
}

export interface RenameModalProps {
    opened: boolean;
    initialName: string;
    onRename: (newName: string) => void;
    onClose: () => void;
}

export function RenameModal({ opened, initialName, onRename, onClose }: RenameModalProps) {
    const [name, setName] = useState(initialName);

    useEffect(() => {
        setName(initialName);
    }, [initialName, opened]);

    const handleSubmit = () => {
        if (!name.trim()) return;
        onRename(name.trim());
    };

    return (
        <Modal opened={opened} onClose={onClose} title="名前の変更" size="sm">
            <Stack gap="md">
                <TextInput
                    label="新しい名前"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    autoFocus
                />
                <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={onClose}>キャンセル</Button>
                    <Button onClick={handleSubmit} disabled={!name.trim() || name.trim() === initialName}>変更</Button>
                </Group>
            </Stack>
        </Modal>
    );
}

export interface NewFolderModalProps {
    opened: boolean;
    onCreate: (folderName: string) => void;
    onClose: () => void;
}

export function NewFolderModal({ opened, onCreate, onClose }: NewFolderModalProps) {
    const [name, setName] = useState('');

    useEffect(() => {
        if (opened) setName('');
    }, [opened]);

    const handleSubmit = () => {
        if (!name.trim()) return;
        onCreate(name.trim());
    };

    return (
        <Modal opened={opened} onClose={onClose} title="新しいフォルダ" size="sm">
            <Stack gap="md">
                <TextInput
                    placeholder="フォルダ名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    autoFocus
                />
                <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={onClose}>キャンセル</Button>
                    <Button onClick={handleSubmit} disabled={!name.trim()}>作成</Button>
                </Group>
            </Stack>
        </Modal>
    );
}

export interface NewFileModalProps {
    opened: boolean;
    onCreate: (fileName: string) => void;
    onClose: () => void;
}

export function NewFileModal({ opened, onCreate, onClose }: NewFileModalProps) {
    const [name, setName] = useState('');

    useEffect(() => {
        if (opened) setName('');
    }, [opened]);

    const handleSubmit = () => {
        if (!name.trim()) return;
        onCreate(name.trim());
    };

    return (
        <Modal opened={opened} onClose={onClose} title="新しいファイル" size="sm">
            <Stack gap="md">
                <TextInput
                    placeholder="例: memo.txt"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    autoFocus
                />
                <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={onClose}>キャンセル</Button>
                    <Button onClick={handleSubmit} disabled={!name.trim()}>作成</Button>
                </Group>
            </Stack>
        </Modal>
    );
}
