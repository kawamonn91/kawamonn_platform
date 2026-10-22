import { useRef, useState } from 'react';
import {
    ActionIcon, Alert, Button, Group, Loader, Menu, Modal, ScrollArea, Stack, Text, TextInput,
} from '@mantine/core';
import {
    IconAlertCircle, IconChevronRight, IconDots, IconDownload, IconEdit,
    IconFile, IconFilePlus, IconFileText, IconFolder, IconFolderPlus,
    IconHome, IconRefresh, IconTrash, IconUpload,
} from '@tabler/icons-react';
import { getErrorMessage } from '../api/client';
import { formatBytes, isEditableFile } from '../api/files';
import {
    type StorageEntry,
    deleteEntry, joinPath, makeFolder, parentOf,
    renameEntry, saveErrorMessage, uploadFile, validateNewEntryName,
} from '../api/storage';
import { useFileBrowser } from '../hooks/useFileBrowser';
import TextEditorModal from './TextEditorModal';

export default function SshFileBrowser() {
    const [error, setError] = useState('');
    const {
        currentPath,
        entries,
        loading,
        crumbs: breadcrumbs,
        fetchDir: rawFetchDir,
        editorPath,
        editorContent,
        setEditorContent,
        editorLoading,
        editorSaving,
        editorIsNew,
        openEditor,
        openNewEditor,
        closeEditor,
        saveEditor,
        downloadEntry,
    } = useFileBrowser({
        rootLabel: 'Home',
        retryReads: true,
        onError: setError,
    });

    const fetchDir = async (path: string) => {
        setError('');
        await rawFetchDir(path);
    };

    // フォルダ作成
    const [newFolderModal, setNewFolderModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    // 名前変更
    const [renameModal, setRenameModal] = useState(false);
    const [renameTarget, setRenameTarget] = useState<StorageEntry | null>(null);
    const [renameName, setRenameName] = useState('');
    // 新規ファイル作成
    const [newFileModal, setNewFileModal] = useState(false);
    const [newFileName, setNewFileName] = useState('');

    const uploadRef = useRef<HTMLInputElement>(null);

    const navigateUp = () => {
        if (currentPath === '/') return;
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        void fetchDir(parent);
    };

    const handleDelete = async (entry: StorageEntry) => {
        if (!window.confirm(`「${entry.name}」を削除しますか？`)) return;
        try {
            await deleteEntry(entry.path);
            await fetchDir(currentPath);
        } catch (e) {
            setError(getErrorMessage(e, '削除に失敗しました'));
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        if (
            entries.some((en) => en.name === file.name) &&
            !window.confirm(`「${file.name}」は同じ名前のものがあるので上書きされます。よろしいですか？`)
        ) {
            e.target.value = '';
            return;
        }
        try {
            await uploadFile(currentPath, file);
            await fetchDir(currentPath);
        } catch (err) {
            setError(saveErrorMessage(err, 'アップロードに失敗しました'));
        }
        e.target.value = '';
    };

    const handleMkdir = async () => {
        const check = validateNewEntryName(newFolderName, entries);
        if (check.error !== undefined) {
            setError(check.error);
            return;
        }
        try {
            await makeFolder(joinPath(currentPath, check.name));
            setNewFolderModal(false);
            setNewFolderName('');
            await fetchDir(currentPath);
        } catch (e) {
            setError(getErrorMessage(e, 'フォルダ作成に失敗しました'));
        }
    };

    const openRename = (entry: StorageEntry) => {
        setRenameTarget(entry);
        setRenameName(entry.name);
        setRenameModal(true);
    };

    const handleRename = async () => {
        if (!renameTarget) return;
        if (renameName.trim() === renameTarget.name) {
            setRenameModal(false);
            setRenameTarget(null);
            return;
        }
        const check = validateNewEntryName(renameName, entries, renameTarget.path);
        if (check.error !== undefined) {
            setError(check.error);
            return;
        }
        try {
            await renameEntry(renameTarget.path, joinPath(parentOf(renameTarget.path), check.name));
            setRenameModal(false);
            setRenameTarget(null);
            await fetchDir(currentPath);
        } catch (e) {
            setError(getErrorMessage(e, '名前変更に失敗しました'));
        }
    };

    const openNewFile = () => {
        setNewFileName('');
        setNewFileModal(true);
    };

    const handleCreateNewFile = () => {
        const check = validateNewEntryName(newFileName, entries);
        if (check.error !== undefined) {
            setError(check.error);
            return;
        }
        const relPath = joinPath(currentPath, check.name);
        setNewFileModal(false);
        openNewEditor(relPath, true);
    };

    return (
        <Stack gap={0} style={{ height: '100%' }}>
            {/* パンくずリスト */}
            <Group
                px="sm"
                py={5}
                style={{ borderBottom: '1px solid #30363d', background: '#0d1117', flexShrink: 0 }}
            >
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => void fetchDir('/')} title="ホームへ">
                    <IconHome size={12} />
                </ActionIcon>
                {breadcrumbs.map((crumb, i) => (
                    <Group key={crumb.path} gap={2} wrap="nowrap">
                        {i > 0 && <IconChevronRight size={9} color="#484f58" />}
                        <Text
                            size="xs"
                            c={i === breadcrumbs.length - 1 ? 'white' : 'blue'}
                            style={{ cursor: i === breadcrumbs.length - 1 ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                            onClick={() => i < breadcrumbs.length - 1 && void fetchDir(crumb.path)}
                        >
                            {crumb.name}
                        </Text>
                    </Group>
                ))}
            </Group>

            {/* アクションボタン */}
            <Group
                px="xs"
                py={5}
                gap={4}
                style={{ borderBottom: '1px solid #30363d', background: '#161b22', flexShrink: 0 }}
            >
                <Button
                    size="compact-xs"
                    variant="subtle"
                    color="blue"
                    leftSection={<IconFolderPlus size={12} />}
                    onClick={() => setNewFolderModal(true)}
                >
                    新規フォルダ
                </Button>
                <Button
                    size="compact-xs"
                    variant="subtle"
                    color="teal"
                    leftSection={<IconFilePlus size={12} />}
                    onClick={openNewFile}
                >
                    新規ファイル
                </Button>
                <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconUpload size={12} />}
                    onClick={() => uploadRef.current?.click()}
                >
                    アップロード
                </Button>
                <input ref={uploadRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => void fetchDir(currentPath)} title="再読み込み" style={{ marginLeft: 'auto' }}>
                    <IconRefresh size={12} />
                </ActionIcon>
            </Group>

            {/* エラー表示 */}
            {error && (
                <Alert icon={<IconAlertCircle size={14} />} color="red" p="xs" m="xs" withCloseButton onClose={() => setError('')}>
                    <Text size="xs">{error}</Text>
                </Alert>
            )}

            {/* ファイル一覧 */}
            <ScrollArea style={{ flex: 1 }}>
                {loading ? (
                    <Stack align="center" py="xl">
                        <Loader size="sm" color="blue" />
                    </Stack>
                ) : entries.length === 0 ? (
                    <Stack align="center" py="xl" gap="xs">
                        <IconFolder size={32} color="#484f58" />
                        <Text size="xs" c="dimmed">空のディレクトリです</Text>
                    </Stack>
                ) : (
                    <Stack gap={0}>
                        {currentPath !== '/' && (
                            <Group
                                px="sm"
                                py={6}
                                gap="xs"
                                style={{ cursor: 'pointer', borderBottom: '1px solid #21262d' }}
                                onClick={navigateUp}
                            >
                                <IconFolder size={14} color="#58a6ff" />
                                <Text size="xs" c="dimmed">..</Text>
                            </Group>
                        )}
                        {entries.map((entry) => (
                            <Group
                                key={entry.path}
                                px="sm"
                                py={6}
                                gap="xs"
                                justify="space-between"
                                style={{
                                    cursor: 'pointer',
                                    borderBottom: '1px solid #21262d',
                                    transition: 'background 0.15s',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#161b22')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                onClick={() => {
                                    if (entry.isDir) {
                                        void fetchDir(entry.path);
                                    } else if (isEditableFile(entry.name, entry.mime)) {
                                        void openEditor(entry.path);
                                    }
                                }}
                            >
                                <Group gap="xs" wrap="nowrap" style={{ overflow: 'hidden', flex: 1 }}>
                                    {entry.isDir ? (
                                        <IconFolder size={14} color="#58a6ff" style={{ flexShrink: 0 }} />
                                    ) : isEditableFile(entry.name, entry.mime) ? (
                                        <IconFileText size={14} color="#3fb950" style={{ flexShrink: 0 }} />
                                    ) : (
                                        <IconFile size={14} color="#8b949e" style={{ flexShrink: 0 }} />
                                    )}
                                    <Text size="xs" c="gray.3" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {entry.name}
                                    </Text>
                                </Group>
                                <Group gap={4} wrap="nowrap">
                                    {!entry.isDir && (
                                        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                                            {formatBytes(entry.size)}
                                        </Text>
                                    )}
                                    <Menu shadow="md" width={160} position="bottom-end">
                                        <Menu.Target>
                                            <ActionIcon
                                                size="xs"
                                                variant="subtle"
                                                color="gray"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <IconDots size={12} />
                                            </ActionIcon>
                                        </Menu.Target>
                                        <Menu.Dropdown style={{ background: '#161b22', border: '1px solid #30363d' }}>
                                            {!entry.isDir && isEditableFile(entry.name, entry.mime) && (
                                                <Menu.Item
                                                    leftSection={<IconEdit size={13} />}
                                                    onClick={(e) => { e.stopPropagation(); void openEditor(entry.path); }}
                                                    style={{ color: '#e6edf3', fontSize: 12 }}
                                                >
                                                    編集
                                                </Menu.Item>
                                            )}
                                            {!entry.isDir && (
                                                <Menu.Item
                                                    leftSection={<IconDownload size={13} />}
                                                    onClick={(e) => { e.stopPropagation(); void downloadEntry(entry); }}
                                                    style={{ color: '#e6edf3', fontSize: 12 }}
                                                >
                                                    ダウンロード
                                                </Menu.Item>
                                            )}
                                            <Menu.Item
                                                leftSection={<IconEdit size={13} />}
                                                onClick={(e) => { e.stopPropagation(); openRename(entry); }}
                                                style={{ color: '#e6edf3', fontSize: 12 }}
                                            >
                                                名前変更
                                            </Menu.Item>
                                            <Menu.Item
                                                leftSection={<IconTrash size={13} />}
                                                color="red"
                                                onClick={(e) => { e.stopPropagation(); void handleDelete(entry); }}
                                                style={{ fontSize: 12 }}
                                            >
                                                削除
                                            </Menu.Item>
                                        </Menu.Dropdown>
                                    </Menu>
                                </Group>
                            </Group>
                        ))}
                    </Stack>
                )}
            </ScrollArea>

            {/* フォルダ作成モーダル */}
            <Modal
                opened={newFolderModal}
                onClose={() => { setNewFolderModal(false); setNewFolderName(''); }}
                title="新しいフォルダ"
                size="sm"
                styles={{ content: { background: '#161b22', border: '1px solid #30363d' }, header: { background: '#161b22' }, title: { color: 'white' } }}
            >
                <Stack>
                    <TextInput
                        placeholder="フォルダ名"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void handleMkdir()}
                        styles={{ input: { background: '#0d1117', borderColor: '#30363d', color: 'white' } }}
                        autoFocus
                    />
                    <Button onClick={() => void handleMkdir()} color="blue" disabled={!newFolderName.trim()}>作成</Button>
                </Stack>
            </Modal>

            {/* 名前変更モーダル */}
            <Modal
                opened={renameModal}
                onClose={() => { setRenameModal(false); setRenameTarget(null); }}
                title="名前変更"
                size="sm"
                styles={{ content: { background: '#161b22', border: '1px solid #30363d' }, header: { background: '#161b22' }, title: { color: 'white' } }}
            >
                <Stack>
                    <TextInput
                        placeholder="新しい名前"
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void handleRename()}
                        styles={{ input: { background: '#0d1117', borderColor: '#30363d', color: 'white' } }}
                        autoFocus
                    />
                    <Button onClick={() => void handleRename()} color="blue" disabled={!renameName.trim()}>変更</Button>
                </Stack>
            </Modal>

            {/* 新規ファイル名入力モーダル */}
            <Modal
                opened={newFileModal}
                onClose={() => setNewFileModal(false)}
                title="新規ファイルの作成"
                size="sm"
                styles={{ content: { background: '#161b22', border: '1px solid #30363d' }, header: { background: '#161b22' }, title: { color: 'white' } }}
            >
                <Stack>
                    <TextInput
                        placeholder="ファイル名 (e.g. notes.txt, script.py)"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateNewFile()}
                        styles={{ input: { background: '#0d1117', borderColor: '#30363d', color: 'white' } }}
                        autoFocus
                    />
                    <Button
                        onClick={handleCreateNewFile}
                        color="teal"
                        leftSection={<IconFilePlus size={14} />}
                        disabled={!newFileName.trim()}
                    >
                        作成して編集
                    </Button>
                </Stack>
            </Modal>

            <TextEditorModal
                opened={editorPath !== null}
                path={editorPath ?? ''}
                content={editorContent}
                onChange={setEditorContent}
                onSave={() => void saveEditor()}
                onClose={closeEditor}
                loading={editorLoading}
                saving={editorSaving}
                isNew={editorIsNew}
            />
        </Stack>
    );
}
