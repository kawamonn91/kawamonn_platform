import { useState } from 'react';
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
    return (
        <Modal opened={opened} onClose={onClose} title="名前の変更" size="sm">
            <NameForm
                initialName={initialName}
                label="新しい名前"
                submitLabel="変更"
                requireChange
                onSubmit={onRename}
                onClose={onClose}
            />
        </Modal>
    );
}

export interface NewFolderModalProps {
    opened: boolean;
    onCreate: (folderName: string) => void;
    onClose: () => void;
}

export function NewFolderModal({ opened, onCreate, onClose }: NewFolderModalProps) {
    return (
        <Modal opened={opened} onClose={onClose} title="新しいフォルダ" size="sm">
            <NameForm placeholder="フォルダ名" submitLabel="作成" onSubmit={onCreate} onClose={onClose} />
        </Modal>
    );
}

export interface NewFileModalProps {
    opened: boolean;
    onCreate: (fileName: string) => void;
    onClose: () => void;
}

export function NewFileModal({ opened, onCreate, onClose }: NewFileModalProps) {
    return (
        <Modal opened={opened} onClose={onClose} title="新しいファイル" size="sm">
            <NameForm placeholder="例: memo.txt" submitLabel="作成" onSubmit={onCreate} onClose={onClose} />
        </Modal>
    );
}

interface NameFormProps {
    initialName?: string;
    label?: string;
    placeholder?: string;
    submitLabel: string;
    /** 元の名前のままなら決定できない(名前の変更) */
    requireChange?: boolean;
    onSubmit: (name: string) => void;
    onClose: () => void;
}

/**
 * 名前を1つ入力する欄。Modal は閉じると中身を外すので、開くたびに initialName から始まる
 * (以前は開くたびに useEffect で入力欄を戻していた)
 */
function NameForm({ initialName = '', label, placeholder, submitLabel, requireChange, onSubmit, onClose }: NameFormProps) {
    const [name, setName] = useState(initialName);
    const trimmed = name.trim();
    const disabled = !trimmed || (requireChange === true && trimmed === initialName);

    const handleSubmit = () => {
        if (disabled) return;
        onSubmit(trimmed);
    };

    return (
        <Stack gap="md">
            <TextInput
                label={label}
                placeholder={placeholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                autoFocus
            />
            <Group justify="flex-end" gap="xs">
                <Button variant="default" onClick={onClose}>キャンセル</Button>
                <Button onClick={handleSubmit} disabled={disabled}>{submitLabel}</Button>
            </Group>
        </Stack>
    );
}
