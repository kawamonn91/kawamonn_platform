import { useState, useRef, useCallback } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text, Grid,
    Breadcrumbs, Anchor, Center, Stack, Burger, Drawer, Divider, Progress, Modal,
} from '@mantine/core';
import {
    IconUpload, IconFolder, IconFolderPlus, IconTerminal2,
    IconPlus, IconChevronRight, IconSettings, IconFilePlus,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useDisclosure } from '@mantine/hooks';
import { type StorageEntry, joinPath } from '../api/storage';
import { formatBytes, isEditableFile, isPreviewable } from '../api/files';
import api from '../api/client';
import * as pdfjsLib from 'pdfjs-dist';
import { useAuth } from '../AuthContext';
import TextEditorModal from '../components/TextEditorModal';
import FolderCard from '../components/FolderCard';
import FileCard from '../components/FileCard';
import FilePreviewModal from '../components/FilePreviewModal';
import { useFileBrowser } from '../hooks/useFileBrowser';
import {
    ConfirmModal,
    RenameModal,
    NewFolderModal,
    NewFileModal,
} from '../components/FileBrowserModals';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

export default function StorageDashboard() {
    const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
    const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
    const [previewEntry, setPreviewEntry] = useState<StorageEntry | null>(null);
    const [errorModal, setErrorModal] = useState<string | null>(null);

    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const { logout, userRole } = useAuth();

    // 使用量と上限(10分ごとの測り直しと、Web からの保存で更新される値)
    const fetchUsage = useCallback(async () => {
        try {
            const res = await api.get('/api/v1/users/me');
            setUsage({ used: Number(res.data.used_bytes), quota: Number(res.data.quota_bytes) });
        } catch {
            // 401 is handled globally by the api client's interceptor
        }
    }, []);

    const {
        currentPath,
        entries,
        loading,
        crumbs,
        fetchDir,
        editorPath,
        editorContent,
        setEditorContent,
        editorLoading,
        editorSaving,
        openEditor,
        openNewEditor,
        closeEditor,
        saveEditor: handleSaveFile,
        downloadEntry: handleDownload,
        createFolder,
        createFile,
        rename,
        deleteItem,
        uploadFiles,
        uploadProgress,
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
        rootLabel: 'マイファイル',
        onAfterRefresh: () => void fetchUsage(),
        onError: (msg) => setErrorModal(msg),
    });

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!picked.length) return;

        const conflicts = picked.filter((f) => entries.some((e) => e.name === f.name)).map((f) => f.name);
        if (conflicts.length) {
            askConfirm(
                '上書きの確認',
                `次のファイルは同じ名前のものがあるので上書きされます。よろしいですか？\n${conflicts.join('\n')}`,
                () => void uploadFiles(picked),
            );
            return;
        }
        void uploadFiles(picked);
    };

    const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!picked.length) return;

        const topName = picked[0].webkitRelativePath.split('/')[0];
        const dirOf = (file: File) =>
            file.webkitRelativePath.split('/').slice(0, -1).reduce((dir, part) => joinPath(dir, part), currentPath);

        if (entries.some((e) => e.name === topName)) {
            askConfirm(
                '上書きの確認',
                `「${topName}」という名前のものがすでにあります。中の同じ名前のファイルは上書きされます。よろしいですか？`,
                () => void uploadFiles(picked, dirOf, (f) => f.webkitRelativePath),
            );
            return;
        }
        void uploadFiles(picked, dirOf, (f) => f.webkitRelativePath);
    };

    const handleDelete = (entry: StorageEntry) => {
        askConfirm(
            '削除の確認',
            `"${entry.name}" を削除しますか？${entry.isDir ? '\n※ フォルダ内のファイルも全て削除されます。' : ''}`,
            () => void deleteItem(entry),
        );
    };

    const handleOpenFile = (entry: StorageEntry) => {
        if (isEditableFile(entry.name, entry.mime)) void openEditor(entry.path);
        else if (isPreviewable(entry.mime)) setPreviewEntry(entry);
        else void handleDownload(entry);
    };

    const goTo = (path: string) => {
        if (path !== currentPath) void fetchDir(path);
    };

    const folders = entries.filter((e) => e.isDir);
    const files = entries.filter((e) => !e.isDir);

    const sidebarJsx = (
        <Stack justify="space-between" h="100%">
            <Stack gap="xs">
                <Button
                    variant="light"
                    leftSection={<IconUpload size={16} />}
                    fullWidth
                    onClick={() => fileInputRef.current?.click()}
                >
                    ファイルをアップロード
                </Button>
                <Button
                    variant="light"
                    leftSection={<IconFolderPlus size={16} />}
                    fullWidth
                    onClick={() => folderInputRef.current?.click()}
                >
                    フォルダをアップロード
                </Button>
                <Button
                    variant="light"
                    color="teal"
                    leftSection={<IconPlus size={16} />}
                    fullWidth
                    onClick={() => { openFolderModal(); closeDrawer(); }}
                >
                    新規フォルダを作成
                </Button>
                <Button
                    variant="light"
                    color="cyan"
                    leftSection={<IconFilePlus size={16} />}
                    fullWidth
                    onClick={() => { openFileModal(); closeDrawer(); }}
                >
                    新規ファイルを作成
                </Button>
                <Divider my="xs" />
                <Button
                    variant={currentPath === '/' ? 'light' : 'subtle'}
                    leftSection={<IconFolder size={16} />}
                    fullWidth
                    justify="flex-start"
                    onClick={() => { goTo('/'); closeDrawer(); }}
                >
                    マイファイル
                </Button>
                <Button
                    variant="subtle"
                    color="cyan"
                    leftSection={<IconTerminal2 size={16} />}
                    fullWidth
                    justify="flex-start"
                    onClick={() => navigate('/ssh')}
                >
                    SSH サンドボックス
                </Button>
            </Stack>
            {usage && usage.quota > 0 && (
                <Stack gap={4}>
                    <Text size="xs" c="dimmed">ストレージの使用量</Text>
                    <Progress
                        value={Math.min((usage.used / usage.quota) * 100, 100)}
                        color={usage.used / usage.quota > 0.9 ? 'red' : 'blue'}
                        size="sm"
                    />
                    <Text size="xs" c="dimmed">
                        {formatBytes(usage.used)} / {formatBytes(usage.quota)}
                    </Text>
                </Stack>
            )}
        </Stack>
    );

    return (
        <>
            <input
                type="file"
                multiple
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileUpload}
            />
            <input
                type="file"
                ref={folderInputRef}
                style={{ display: 'none' }}
                // @ts-expect-error – webkitdirectory is non-standard but widely supported
                webkitdirectory=""
                multiple
                onChange={handleFolderUpload}
            />

            <Drawer opened={drawerOpened} onClose={closeDrawer} title="UoA Online" size="xs">
                {sidebarJsx}
            </Drawer>

            <AppShell
                header={{ height: 60 }}
                navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true } }}
                padding="md"
            >
                <AppShell.Header>
                    <Group h="100%" px="md" justify="space-between">
                        <Group gap="sm">
                            <Burger
                                opened={drawerOpened}
                                onClick={drawerOpened ? closeDrawer : openDrawer}
                                hiddenFrom="sm"
                                size="sm"
                            />
                            <Title order={3}>UoA Online</Title>
                        </Group>
                        <Group gap="sm">
                            {userRole === 'admin' && (
                                <Button variant="subtle" size="sm" onClick={() => navigate('/admin')}>Admin</Button>
                            )}
                            <Button
                                variant="subtle"
                                size="sm"
                                leftSection={<IconSettings size={16} />}
                                onClick={() => navigate('/settings')}
                            >
                                設定
                            </Button>
                            <Button
                                variant="light"
                                color="red"
                                size="sm"
                                onClick={() => { logout(); navigate('/login'); }}
                            >
                                Logout
                            </Button>
                        </Group>
                    </Group>
                </AppShell.Header>

                <AppShell.Navbar p="md">
                    {sidebarJsx}
                </AppShell.Navbar>

                <AppShell.Main>
                    <Container fluid>
                        {uploadProgress !== null && (
                            <Progress value={uploadProgress} mb="sm" animated />
                        )}

                        <Group mb="md">
                            <Breadcrumbs separator={<IconChevronRight size={14} />}>
                                {crumbs.map((c) => (
                                    <Anchor
                                        key={c.path}
                                        size="sm"
                                        onClick={() => goTo(c.path)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {c.name}
                                    </Anchor>
                                ))}
                            </Breadcrumbs>
                        </Group>

                        {loading ? (
                            <Center py="xl"><Text c="dimmed">読み込み中...</Text></Center>
                        ) : entries.length === 0 ? (
                            <Center py="xl">
                                <Stack align="center" gap="xs">
                                    <IconFolder size={64} color="lightgray" />
                                    <Text c="dimmed">ファイルはありません</Text>
                                </Stack>
                            </Center>
                        ) : (
                            <>
                                {folders.length > 0 && (
                                    <>
                                        <Text fw={600} size="sm" mb="sm" c="dimmed">フォルダ</Text>
                                        <Grid gutter="md" mb="xl">
                                            {folders.map((entry) => (
                                                <FolderCard
                                                    key={entry.path}
                                                    entry={entry}
                                                    onOpen={(e) => goTo(e.path)}
                                                    onDelete={handleDelete}
                                                    onRename={openRename}
                                                />
                                            ))}
                                        </Grid>
                                    </>
                                )}

                                {files.length > 0 && (
                                    <>
                                        <Text fw={600} size="sm" mb="sm" c="dimmed">ファイル</Text>
                                        <Grid gutter="md">
                                            {files.map((entry) => (
                                                <FileCard
                                                    key={entry.path}
                                                    entry={entry}
                                                    onOpen={handleOpenFile}
                                                    onDownload={(e) => void handleDownload(e)}
                                                    onDelete={handleDelete}
                                                    onRename={openRename}
                                                />
                                            ))}
                                        </Grid>
                                    </>
                                )}
                            </>
                        )}

                        <TextEditorModal
                            opened={editorPath !== null}
                            path={editorPath ?? ''}
                            content={editorContent}
                            onChange={setEditorContent}
                            onSave={() => void handleSaveFile()}
                            onClose={closeEditor}
                            loading={editorLoading}
                            saving={editorSaving}
                        />

                        <FilePreviewModal
                            entry={previewEntry}
                            onClose={() => setPreviewEntry(null)}
                            onDownload={(e) => void handleDownload(e)}
                        />

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
                                void createFile(name).then((ok) => {
                                    if (ok) openNewEditor(joinPath(currentPath, name), false);
                                });
                            }}
                            onClose={closeFileModal}
                        />

                        {errorModal && (
                            <Modal opened={errorModal !== null} onClose={() => setErrorModal(null)} title="エラー" size="sm">
                                <Stack gap="md">
                                    <Text size="sm" c="red">{errorModal}</Text>
                                    <Group justify="flex-end">
                                        <Button variant="default" onClick={() => setErrorModal(null)}>閉じる</Button>
                                    </Group>
                                </Stack>
                            </Modal>
                        )}
                    </Container>
                </AppShell.Main>
            </AppShell>
        </>
    );
}
