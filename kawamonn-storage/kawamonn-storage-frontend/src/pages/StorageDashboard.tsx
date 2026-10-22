import { useState, useRef, useCallback } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text, Card, Grid,
    ActionIcon, TextInput, Breadcrumbs, Anchor, Center,
    Stack, Burger, Drawer, Divider, Progress,
} from '@mantine/core';
import {
    IconUpload, IconFolder, IconFolderPlus, IconTerminal2,
    IconPlus, IconChevronRight, IconSettings, IconFilePlus,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useDisclosure } from '@mantine/hooks';
import {
    type StorageEntry,
    deleteEntry, joinPath, makeFolder,
    saveErrorMessage, uploadFile, validateNewEntryName, writeText,
} from '../api/storage';
import { formatBytes, isEditableFile, isPreviewable } from '../api/files';
import api from '../api/client';
import * as pdfjsLib from 'pdfjs-dist';
import { useAuth } from '../AuthContext';
import TextEditorModal from '../components/TextEditorModal';
import FolderCard from '../components/FolderCard';
import FileCard from '../components/FileCard';
import FilePreviewModal from '../components/FilePreviewModal';
import { useFileBrowser } from '../hooks/useFileBrowser';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

export default function StorageDashboard() {
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

    const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
    const [folderFormOpened, { open: openFolderForm, close: closeFolderForm }] = useDisclosure(false);
    const [newFolderName, setNewFolderName] = useState('');

    const [fileFormOpened, { open: openFileForm, close: closeFileForm }] = useDisclosure(false);
    const [newFileName, setNewFileName] = useState('');

    const [previewEntry, setPreviewEntry] = useState<StorageEntry | null>(null);

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
        refresh: fetchFiles,
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
    } = useFileBrowser({
        rootLabel: 'マイファイル',
        onAfterRefresh: () => void fetchUsage(),
        onError: (msg) => alert(msg),
    });

    const nameTaken = (name: string) => entries.some((e) => e.name === name);

    const handleCreateFolder = async () => {
        const check = validateNewEntryName(newFolderName, entries);
        if (check.error !== undefined) {
            alert(check.error);
            return;
        }
        try {
            await makeFolder(joinPath(currentPath, check.name));
            setNewFolderName('');
            closeFolderForm();
            await fetchFiles();
        } catch (err) {
            console.error('Folder creation failed', err);
            alert('フォルダの作成に失敗しました');
        }
    };

    const handleCreateFile = async () => {
        const check = validateNewEntryName(newFileName, entries);
        if (check.error !== undefined) {
            alert(check.error);
            return;
        }
        const path = joinPath(currentPath, check.name);
        try {
            await writeText(path, '');
            setNewFileName('');
            closeFileForm();
            await fetchFiles();
            // 作ったファイルをそのままエディタで開く
            openNewEditor(path, false);
        } catch (err) {
            console.error('File creation failed', err);
            alert(saveErrorMessage(err, 'ファイルの作成に失敗しました'));
        }
    };

    // 選んだファイルを順に置く。dirOf はファイルごとの置き場所
    const uploadAll = async (files: File[], dirOf: (file: File) => string, labelOf: (file: File) => string) => {
        setUploadProgress(0);
        const failed: string[] = [];
        const reasons = new Set<string>();
        for (const [i, file] of files.entries()) {
            try {
                await uploadFile(dirOf(file), file);
            } catch (err) {
                reasons.add(saveErrorMessage(err, 'アップロードに失敗しました'));
                failed.push(labelOf(file));
            }
            setUploadProgress(Math.round(((i + 1) / files.length) * 100));
        }
        setUploadProgress(null);
        if (failed.length) {
            alert(`${[...reasons].join('\n')}\n以下のファイルのアップロードに失敗しました:\n${failed.join('\n')}`);
        }
        await fetchFiles();
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!picked.length) return;

        const conflicts = picked.filter((f) => nameTaken(f.name)).map((f) => f.name);
        if (
            conflicts.length &&
            !window.confirm(
                `次のファイルは同じ名前のものがあるので上書きされます。よろしいですか？\n${conflicts.join('\n')}`,
            )
        ) {
            return;
        }
        await uploadAll(picked, () => currentPath, (f) => f.name);
    };

    const handleFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!picked.length) return;

        const topName = picked[0].webkitRelativePath.split('/')[0];
        if (
            nameTaken(topName) &&
            !window.confirm(
                `「${topName}」という名前のものがすでにあります。中の同じ名前のファイルは上書きされます。よろしいですか？`,
            )
        ) {
            return;
        }
        const dirOf = (file: File) =>
            file.webkitRelativePath.split('/').slice(0, -1).reduce((dir, part) => joinPath(dir, part), currentPath);
        await uploadAll(picked, dirOf, (f) => f.webkitRelativePath);
    };

    const handleDelete = async (entry: StorageEntry) => {
        const label = entry.isDir ? 'フォルダ' : 'ファイル';
        if (
            !window.confirm(
                `"${entry.name}" を削除しますか？${entry.isDir ? '\n※ フォルダ内のファイルも全て削除されます。' : ''}`,
            )
        ) {
            return;
        }
        try {
            await deleteEntry(entry.path);
            await fetchFiles();
        } catch {
            alert(`${label}の削除に失敗しました`);
        }
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
        <Stack h="100%" justify="space-between">
            <Stack gap="sm">
                <Button
                    leftSection={<IconUpload size={16} />}
                    fullWidth
                    onClick={() => { fileInputRef.current?.click(); closeDrawer(); }}
                >
                    ファイルをアップロード
                </Button>
                <Button
                    variant="default"
                    leftSection={<IconFolderPlus size={16} />}
                    fullWidth
                    onClick={() => { folderInputRef.current?.click(); closeDrawer(); }}
                >
                    フォルダをアップロード
                </Button>
                <Button
                    variant="light"
                    color="teal"
                    leftSection={<IconPlus size={16} />}
                    fullWidth
                    onClick={() => { openFolderForm(); closeDrawer(); }}
                >
                    新規フォルダを作成
                </Button>
                <Button
                    variant="light"
                    color="cyan"
                    leftSection={<IconFilePlus size={16} />}
                    fullWidth
                    onClick={() => { openFileForm(); closeDrawer(); }}
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
                                                    onDelete={(e) => void handleDelete(e)}
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
                                                    onDelete={(e) => void handleDelete(e)}
                                                />
                                            ))}
                                        </Grid>
                                    </>
                                )}
                            </>
                        )}

                        {folderFormOpened && (
                            <Card withBorder shadow="sm" radius="md" p="md" mb="md" style={{ maxWidth: 360 }}>
                                <Group justify="space-between" mb="xs">
                                    <Text fw={600} size="sm">新規フォルダを作成</Text>
                                    <ActionIcon variant="subtle" onClick={closeFolderForm} size="sm">
                                        <IconFolder size={14} />
                                    </ActionIcon>
                                </Group>
                                <TextInput
                                    placeholder="フォルダ名を入力"
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && void handleCreateFolder()}
                                    autoFocus
                                    mb="sm"
                                />
                                <Group gap="xs">
                                    <Button size="sm" onClick={() => void handleCreateFolder()} disabled={!newFolderName.trim()}>
                                        作成
                                    </Button>
                                    <Button size="sm" variant="subtle" color="gray" onClick={closeFolderForm}>
                                        キャンセル
                                    </Button>
                                </Group>
                            </Card>
                        )}

                        {fileFormOpened && (
                            <Card withBorder shadow="sm" radius="md" p="md" mb="md" style={{ maxWidth: 360 }}>
                                <Group justify="space-between" mb="xs">
                                    <Text fw={600} size="sm">新規テキストファイルを作成</Text>
                                    <ActionIcon variant="subtle" onClick={closeFileForm} size="sm">
                                        <IconFilePlus size={14} />
                                    </ActionIcon>
                                </Group>
                                <TextInput
                                    placeholder="ファイル名（例: script.sh）"
                                    value={newFileName}
                                    onChange={(e) => setNewFileName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && void handleCreateFile()}
                                    autoFocus
                                    mb="sm"
                                />
                                <Group gap="xs">
                                    <Button size="sm" color="cyan" onClick={() => void handleCreateFile()} disabled={!newFileName.trim()}>
                                        作成
                                    </Button>
                                    <Button size="sm" variant="subtle" color="gray" onClick={closeFileForm}>
                                        キャンセル
                                    </Button>
                                </Group>
                            </Card>
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
                    </Container>
                </AppShell.Main>
            </AppShell>
        </>
    );
}
