import { useRef, useState } from 'react';
import {
    ActionIcon, Alert, Button, Group, Loader, Menu, ScrollArea, Stack, Text,
} from '@mantine/core';
import {
    IconAlertCircle, IconChevronRight, IconDots, IconDownload, IconEdit,
    IconFile, IconFilePlus, IconFileText, IconFolder, IconFolderPlus,
    IconHome, IconRefresh, IconTrash, IconUpload,
} from '@tabler/icons-react';
import { formatBytes, isEditableFile } from '../api/files';
import { type StorageEntry, joinPath } from '../api/storage';
import { useFileBrowser } from '../hooks/useFileBrowser';
import TextEditorModal from './TextEditorModal';
import {
    ConfirmModal,
    RenameModal,
    NewFolderModal,
    NewFileModal,
} from './FileBrowserModals';

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
        createFolder,
        rename,
        deleteItem,
        uploadFiles,
        confirmState,
        askConfirm,
        closeConfirm,
        renameTarget,
        openRename,
        closeRename,
        folderModalOpened,
        openFolderModal,
        closeFolderModal,
        fileModalOpened,
        openFileModal,
        closeFileModal,
    } = useFileBrowser({
        rootLabel: 'Home',
        retryReads: true,
        onError: setError,
    });

    const fetchDir = async (path: string) => {
        setError('');
        await rawFetchDir(path);
    };

    const uploadRef = useRef<HTMLInputElement>(null);

    const navigateUp = () => {
        if (currentPath === '/') return;
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        void fetchDir(parent);
    };

    const handleDelete = (entry: StorageEntry) => {
        askConfirm('削除の確認', `「${entry.name}」を削除しますか？`, () => void deleteItem(entry));
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        e.target.value = '';
        if (entries.some((en) => en.name === file.name)) {
            askConfirm(
                '上書きの確認',
                `「${file.name}」は同じ名前のものがあるので上書きされます。よろしいですか？`,
                () => void uploadFiles([file]),
            );
            return;
        }
        void uploadFiles([file]);
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
                    onClick={openFolderModal}
                >
                    新規フォルダ
                </Button>
                <Button
                    size="compact-xs"
                    variant="subtle"
                    color="teal"
                    leftSection={<IconFilePlus size={12} />}
                    onClick={openFileModal}
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
                    <Group justify="center" p="xl">
                        <Loader size="sm" color="gray" />
                    </Group>
                ) : (
                    <Stack gap={0} p={4}>
                        {currentPath !== '/' && (
                            <Group
                                px="xs"
                                py={4}
                                gap="xs"
                                onClick={navigateUp}
                                style={{
                                    cursor: 'pointer',
                                    borderRadius: 4,
                                    color: '#8b949e',
                                }}
                                className="file-row"
                            >
                                <IconFolder size={15} color="#8b949e" />
                                <Text size="xs">..</Text>
                            </Group>
                        )}
                        {entries.length === 0 && currentPath === '/' && (
                            <Text size="xs" c="dimmed" p="md" ta="center">ファイルはありません</Text>
                        )}
                        {entries.map((entry) => (
                            <Group
                                key={entry.path}
                                px="xs"
                                py={3}
                                justify="space-between"
                                style={{
                                    borderRadius: 4,
                                    cursor: entry.isDir ? 'pointer' : isEditableFile(entry.name, entry.mime) ? 'pointer' : 'default',
                                }}
                                className="file-row"
                                onClick={() => {
                                    if (entry.isDir) void fetchDir(entry.path);
                                    else if (isEditableFile(entry.name, entry.mime)) void openEditor(entry.path);
                                }}
                            >
                                <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                                    {entry.isDir ? (
                                        <IconFolder size={15} color="#58a6ff" style={{ flexShrink: 0 }} />
                                    ) : isEditableFile(entry.name, entry.mime) ? (
                                        <IconFileText size={15} color="#3fb950" style={{ flexShrink: 0 }} />
                                    ) : (
                                        <IconFile size={15} color="#8b949e" style={{ flexShrink: 0 }} />
                                    )}
                                    <Text
                                        size="xs"
                                        style={{
                                            color: entry.isDir ? '#58a6ff' : '#c9d1d9',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {entry.name}
                                    </Text>
                                </Group>

                                <Group gap={6}>
                                    {!entry.isDir && (
                                        <Text size="xs" c="dimmed" style={{ fontSize: 10 }}>
                                            {formatBytes(entry.size)}
                                        </Text>
                                    )}
                                    <Menu shadow="md" width={130} position="bottom-end">
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
                                        <Menu.Dropdown styles={{ dropdown: { background: '#161b22', borderColor: '#30363d' } }}>
                                            {!entry.isDir && isEditableFile(entry.name, entry.mime) && (
                                                <Menu.Item
                                                    leftSection={<IconEdit size={13} />}
                                                    onClick={(e) => { e.stopPropagation(); void openEditor(entry.path); }}
                                                    styles={{ item: { color: '#c9d1d9', fontSize: 12 } }}
                                                >
                                                    編集
                                                </Menu.Item>
                                            )}
                                            {!entry.isDir && (
                                                <Menu.Item
                                                    leftSection={<IconDownload size={13} />}
                                                    onClick={(e) => { e.stopPropagation(); void downloadEntry(entry); }}
                                                    styles={{ item: { color: '#c9d1d9', fontSize: 12 } }}
                                                >
                                                    ダウンロード
                                                </Menu.Item>
                                            )}
                                            <Menu.Item
                                                leftSection={<IconEdit size={13} />}
                                                onClick={(e) => { e.stopPropagation(); openRename(entry); }}
                                                styles={{ item: { color: '#c9d1d9', fontSize: 12 } }}
                                            >
                                                名前変更
                                            </Menu.Item>
                                            <Menu.Item
                                                color="red"
                                                leftSection={<IconTrash size={13} />}
                                                onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                                                styles={{ item: { fontSize: 12 } }}
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

            <ConfirmModal
                opened={confirmState.opened}
                title={confirmState.title}
                message={confirmState.message}
                onConfirm={confirmState.onConfirm}
                onClose={closeConfirm}
            />

            <RenameModal
                opened={renameTarget !== null}
                initialName={renameTarget?.name ?? ''}
                onRename={(newName) => {
                    if (renameTarget) void rename(renameTarget, newName);
                }}
                onClose={closeRename}
            />

            <NewFolderModal
                opened={folderModalOpened}
                onCreate={(name) => void createFolder(name)}
                onClose={closeFolderModal}
            />

            <NewFileModal
                opened={fileModalOpened}
                onCreate={(name) => {
                    const relPath = joinPath(currentPath, name);
                    closeFileModal();
                    openNewEditor(relPath, true);
                }}
                onClose={closeFileModal}
            />

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
