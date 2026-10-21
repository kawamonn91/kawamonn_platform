import { useEffect, useState, useRef, useCallback } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text, Card, Grid,
    ActionIcon, TextInput, Breadcrumbs, Anchor, Center,
    Stack, Burger, Drawer, Divider, Progress, AspectRatio, Menu, Modal
} from '@mantine/core';
import {
    IconUpload, IconFolder, IconFolderPlus, IconFileText, IconTerminal2,
    IconPlus, IconDownload, IconTrash, IconChevronRight, IconFile, IconFileZip, IconFileCode, IconPhoto, IconSettings, IconDotsVertical, IconFilePlus
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
    type StorageEntry,
    deleteEntry, isValidName, joinPath, listEntries, makeFolder,
    readFileBytes, readFileText, saveErrorMessage, uploadFile, writeText,
} from '../api/storage';
import { formatBytes, isEditableFile, isPreviewable, saveBytesAs } from '../api/files';
import api from '../api/client';
import { createLatestTracker } from '../api/latest';
import * as pdfjsLib from 'pdfjs-dist';
import { useAuth } from '../AuthContext';
import TextEditorModal from '../components/TextEditorModal';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

// ファイルやフォルダはパス("/docs/a.txt")で指す。ファイルは HDD の利用者フォルダにあり、
// SSH 画面の端末・ファイルブラウザと同じものを見ている

const NAME_RULE_MESSAGE = '名前に「/」「\\」は使えません。「.」「..」だけの名前も使えません。';
// サムネイルのために丸ごと読み込むのは、この大きさまで(大きい写真や PDF が並ぶフォルダで重くならないように)
const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;

// -----------------------------------------------
// Icon helper
// -----------------------------------------------
function getFileIcon(mime: string, size = 48) {
    if (mime === 'directory') return <IconFolder size={size} color="#4dabf7" />;
    if (mime.startsWith('image/')) return <IconPhoto size={size} color="#f59f00" />;
    if (mime.startsWith('video/')) return <IconFile size={size} color="#e64980" />;
    if (mime.startsWith('text/')) return <IconFileCode size={size} color="#74c0fc" />;
    if (mime.includes('pdf')) return <IconFileText size={size} color="#e64980" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gz')) return <IconFileZip size={size} color="#a9e34b" />;
    return <IconFileText size={size} color="#adb5bd" />;
}

// -----------------------------------------------
// FolderCard component (Google Drive Style)
// -----------------------------------------------
interface FolderCardProps {
    entry: StorageEntry;
    onOpen: (entry: StorageEntry) => void;
    onDelete: (entry: StorageEntry) => void;
}

function FolderCard({ entry, onOpen, onDelete }: FolderCardProps) {
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

// -----------------------------------------------
// FileCard component (Google Drive Style)
// Loads thumbnails via the shared API client → blob URL
// -----------------------------------------------
interface FileCardProps {
    entry: StorageEntry;
    onOpen: (entry: StorageEntry) => void;
    onDownload: (entry: StorageEntry) => void;
    onDelete: (entry: StorageEntry) => void;
}

function FileCard({ entry, onOpen, onDownload, onDelete }: FileCardProps) {
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;

        const loadThumb = async () => {
            if (!isPreviewable(entry.mime) || entry.size > THUMBNAIL_MAX_BYTES) return;
            try {
                const data = await readFileBytes(entry.path);
                if (cancelled) return;

                if (entry.mime.startsWith('image/')) {
                    objectUrl = URL.createObjectURL(new Blob([data], { type: entry.mime }));
                    setThumbUrl(objectUrl);
                } else {
                    const pdf = await pdfjsLib.getDocument({ data }).promise;
                    if (cancelled) return;
                    const page = await pdf.getPage(1);
                    if (cancelled) return;

                    const vp0 = page.getViewport({ scale: 1 });
                    const scale = 200 / Math.max(vp0.width, vp0.height);
                    const vp = page.getViewport({ scale });

                    const canvas = document.createElement('canvas');
                    canvas.width = vp.width;
                    canvas.height = vp.height;
                    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
                    if (!cancelled) setThumbUrl(canvas.toDataURL());
                }
            } catch (e) {
                console.error('Thumbnail load failed:', e);
            }
        };

        loadThumb();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [entry.path, entry.mime, entry.size]);

    return (
        <Grid.Col span={{ base: 6, sm: 4, md: 3, lg: 2, xl: 2 }}>
            <Card
                shadow="xs"
                padding={0}
                radius="md"
                withBorder
                h="100%"
                style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
                onClick={() => onOpen(entry)}
            >
                {/* Preview area */}
                <Card.Section>
                    <AspectRatio
                        ratio={4 / 3}
                        bg="var(--mantine-color-gray-0, #f8f9fa)"
                        style={{ overflow: 'hidden', borderBottom: '1px solid var(--mantine-color-gray-2)' }}
                    >
                        {thumbUrl ? (
                            <img
                                src={thumbUrl}
                                alt={entry.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        ) : (
                            <Center style={{ width: '100%', height: '100%' }}>
                                {getFileIcon(entry.mime, 64)}
                            </Center>
                        )}
                    </AspectRatio>
                </Card.Section>

                {/* Name & meta */}
                <Group justify="space-between" wrap="nowrap" p="xs" style={{ flexGrow: 1, alignItems: 'flex-start' }}>
                    <Stack gap={2} style={{ overflow: 'hidden' }}>
                        <Text fw={500} size="sm" truncate title={entry.name}>
                            {entry.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {formatBytes(entry.size)}
                        </Text>
                    </Stack>
                    <Menu shadow="md" width={140} position="bottom-end" withinPortal>
                        <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" size="sm" onClick={(e) => e.stopPropagation()}>
                                <IconDotsVertical size={16} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item
                                leftSection={<IconDownload size={14} />}
                                onClick={(e) => { e.stopPropagation(); onDownload(entry); }}
                            >
                                ダウンロード
                            </Menu.Item>
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

// -----------------------------------------------
// Main Dashboard
// -----------------------------------------------
export default function StorageDashboard() {
    const [entries, setEntries] = useState<StorageEntry[]>([]);
    const [currentPath, setCurrentPath] = useState('/');
    const [loading, setLoading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

    const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
    const [folderFormOpened, { open: openFolderForm, close: closeFolderForm }] = useDisclosure(false);
    const [newFolderName, setNewFolderName] = useState('');

    const [fileFormOpened, { open: openFileForm, close: closeFileForm }] = useDisclosure(false);
    const [newFileName, setNewFileName] = useState('');

    // エディタ
    const [editorPath, setEditorPath] = useState<string | null>(null);
    const [editorContent, setEditorContent] = useState('');
    const [editorLoading, setEditorLoading] = useState(false);
    const [editorSaving, setEditorSaving] = useState(false);

    // Preview state
    const [previewOpened, { open: openPreview, close: closePreview }] = useDisclosure(false);
    const [previewEntry, setPreviewEntry] = useState<StorageEntry | null>(null);
    const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [pdfPageNum, setPdfPageNum] = useState(1);
    const [pdfTotalPages, setPdfTotalPages] = useState(1);
    const [pdfDocRef, setPdfDocRef] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width: 768px)');
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

    // 素早くフォルダを移動したとき、遅れて届いた古い一覧で上書きしないよう、最後に頼んだ結果だけを使う
    const latestList = useRef(createLatestTracker());
    const fetchFiles = useCallback(async () => {
        const id = latestList.current.next();
        setLoading(true);
        try {
            const items = await listEntries(currentPath);
            if (latestList.current.isLatest(id)) setEntries(items);
        } catch {
            // 401 is handled globally by the api client's interceptor
        } finally {
            if (latestList.current.isLatest(id)) setLoading(false);
        }
        fetchUsage();
    }, [currentPath, fetchUsage]);

    useEffect(() => { fetchFiles(); }, [fetchFiles]);

    const nameTaken = (name: string) => entries.some((e) => e.name === name);

    const handleCreateFolder = async () => {
        const name = newFolderName.trim();
        if (!name) return;
        if (!isValidName(name)) { alert(NAME_RULE_MESSAGE); return; }
        if (nameTaken(name)) { alert(`「${name}」という名前のものがすでにあります`); return; }
        try {
            await makeFolder(joinPath(currentPath, name));
            setNewFolderName('');
            closeFolderForm();
            fetchFiles();
        } catch (err) {
            console.error('Folder creation failed', err);
            alert('フォルダの作成に失敗しました');
        }
    };

    const openEditor = async (path: string) => {
        setEditorPath(path);
        setEditorContent('');
        setEditorLoading(true);
        try {
            setEditorContent(await readFileText(path));
        } catch (err) {
            console.error('Failed to load file content', err);
            alert('ファイルの読み込みに失敗しました');
            setEditorPath(null);
        } finally {
            setEditorLoading(false);
        }
    };

    const handleCreateFile = async () => {
        const name = newFileName.trim();
        if (!name) return;
        if (!isValidName(name)) { alert(NAME_RULE_MESSAGE); return; }
        // 同じ名前のファイルは1つしか置けないので、上書きしてしまわないよう先に確かめる
        if (nameTaken(name)) { alert(`「${name}」という名前のものがすでにあります`); return; }
        const path = joinPath(currentPath, name);
        try {
            await writeText(path, '');
            setNewFileName('');
            closeFileForm();
            fetchFiles();
            // 作ったファイルをそのままエディタで開く
            setEditorPath(path);
            setEditorContent('');
        } catch (err) {
            console.error('File creation failed', err);
            alert(saveErrorMessage(err, 'ファイルの作成に失敗しました'));
        }
    };

    const handleSaveFile = async () => {
        if (!editorPath) return;
        setEditorSaving(true);
        try {
            await writeText(editorPath, editorContent);
            setEditorPath(null);
            fetchFiles();
        } catch (err) {
            console.error('Failed to save file', err);
            alert(saveErrorMessage(err, '保存に失敗しました'));
        } finally {
            setEditorSaving(false);
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
        fetchFiles();
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!picked.length) return;

        // 同じ名前のファイルは1つしか置けないので、上書きになるものがあれば確かめる
        const conflicts = picked.filter((f) => nameTaken(f.name)).map((f) => f.name);
        if (conflicts.length && !window.confirm(
            `次のファイルは同じ名前のものがあるので上書きされます。よろしいですか？\n${conflicts.join('\n')}`,
        )) return;
        await uploadAll(picked, () => currentPath, (f) => f.name);
    };

    // フォルダごとのアップロード: 選んだフォルダの構成のまま、今のフォルダの下に置く。
    // 途中のフォルダはサーバーが作る。同じ名前のファイルは上書きされる
    const handleFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!picked.length) return;

        const topName = picked[0].webkitRelativePath.split('/')[0];
        if (nameTaken(topName) && !window.confirm(
            `「${topName}」という名前のものがすでにあります。中の同じ名前のファイルは上書きされます。よろしいですか？`,
        )) return;
        // 例: "MyFolder/subdir/file.txt" → "MyFolder/subdir" に置く
        const dirOf = (file: File) =>
            file.webkitRelativePath.split('/').slice(0, -1).reduce((dir, part) => joinPath(dir, part), currentPath);
        await uploadAll(picked, dirOf, (f) => f.webkitRelativePath);
    };

    const handleDownload = async (entry: StorageEntry) => {
        try {
            saveBytesAs(entry.name, await readFileBytes(entry.path), entry.mime);
        } catch {
            alert('ダウンロードに失敗しました');
        }
    };

    const renderPdfPage = async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
        if (!pdfCanvasRef.current) return;
        const page = await doc.getPage(pageNum);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = Math.min(800 / vp0.width, 1000 / vp0.height, 1.5);
        const vp = page.getViewport({ scale });
        const canvas = pdfCanvasRef.current;
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    };

    const handlePreview = async (entry: StorageEntry) => {
        setPreviewEntry(entry);
        setPreviewBlobUrl(null);
        setPdfDocRef(null);
        setPdfPageNum(1);
        setPdfTotalPages(1);
        setPreviewLoading(true);
        openPreview();
        try {
            const data = await readFileBytes(entry.path);
            if (entry.mime.startsWith('image/')) {
                setPreviewBlobUrl(URL.createObjectURL(new Blob([data], { type: entry.mime })));
            } else if (entry.mime === 'application/pdf') {
                const pdf = await pdfjsLib.getDocument({ data }).promise;
                setPdfDocRef(pdf);
                setPdfTotalPages(pdf.numPages);
                // Render first page after the canvas is mounted
                setTimeout(async () => {
                    if (pdfCanvasRef.current) await renderPdfPage(pdf, 1);
                }, 50);
            }
        } catch (e) {
            console.error('Preview failed:', e);
            alert('プレビューの読み込みに失敗しました');
            closePreview();
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleClosePreview = () => {
        closePreview();
        if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
        setPreviewBlobUrl(null);
        setPdfDocRef(null);
    };

    const handlePdfPageChange = async (newPage: number) => {
        if (!pdfDocRef || newPage < 1 || newPage > pdfTotalPages) return;
        setPdfPageNum(newPage);
        await renderPdfPage(pdfDocRef, newPage);
    };

    const handleDelete = async (entry: StorageEntry) => {
        const label = entry.isDir ? 'フォルダ' : 'ファイル';
        if (!window.confirm(`"${entry.name}" を削除しますか？${entry.isDir ? '\n※ フォルダ内のファイルも全て削除されます。' : ''}`)) return;
        try {
            await deleteEntry(entry.path);
            fetchFiles();
        } catch {
            alert(`${label}の削除に失敗しました`);
        }
    };

    // ファイルを開く: 編集できるものはエディタ、画像と PDF はプレビュー、ほかはダウンロード
    const handleOpenFile = (entry: StorageEntry) => {
        if (isEditableFile(entry.name, entry.mime)) openEditor(entry.path);
        else if (isPreviewable(entry.mime)) handlePreview(entry);
        else handleDownload(entry);
    };

    const goTo = (path: string) => {
        if (path !== currentPath) setCurrentPath(path);
    };

    // パンくずリスト: "/a/b" → マイファイル / a / b
    const crumbs = [
        { name: 'マイファイル', path: '/' },
        ...currentPath.split('/').filter(Boolean).map((part, i, all) => ({
            name: part,
            path: '/' + all.slice(0, i + 1).join('/'),
        })),
    ];

    const folders = entries.filter((e) => e.isDir);
    const files = entries.filter((e) => !e.isDir);

    // Sidebar content as JSX (NOT a component) to avoid React remounting on every render
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
            {/* Hidden file inputs */}
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

            {/* Mobile drawer */}
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
                        {/* Upload progress bar */}
                        {uploadProgress !== null && (
                            <Progress value={uploadProgress} mb="sm" animated />
                        )}

                        {/* Breadcrumbs */}
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

                        {/* File grid */}
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
                                                    onDownload={handleDownload}
                                                    onDelete={handleDelete}
                                                />
                                            ))}
                                        </Grid>
                                    </>
                                )}
                            </>
                        )}

                        {/* Inline "New Folder" form — no Modal/portal, no z-index issues */}
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
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                                    autoFocus
                                    mb="sm"
                                />
                                <Group gap="xs">
                                    <Button size="sm" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                                        作成
                                    </Button>
                                    <Button size="sm" variant="subtle" color="gray" onClick={closeFolderForm}>
                                        キャンセル
                                    </Button>
                                </Group>
                            </Card>
                        )}
                        {/* Inline "New File" form */}
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
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
                                    autoFocus
                                    mb="sm"
                                />
                                <Group gap="xs">
                                    <Button size="sm" color="cyan" onClick={handleCreateFile} disabled={!newFileName.trim()}>
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
                            onSave={handleSaveFile}
                            onClose={() => setEditorPath(null)}
                            loading={editorLoading}
                            saving={editorSaving}
                        />

                        {/* Image / PDF Preview Modal */}
                        <Modal
                            opened={previewOpened}
                            onClose={handleClosePreview}
                            title={previewEntry?.name}
                            size="xl"
                            fullScreen={isMobile}
                            styles={{
                                title: { fontWeight: 600 },
                                body: { padding: '12px' },
                            }}
                        >
                            {previewLoading ? (
                                <Center h={300}><Progress value={100} animated style={{ width: '80%' }} /></Center>
                            ) : previewEntry?.mime.startsWith('image/') ? (
                                <Stack align="center" gap="md">
                                    <img
                                        src={previewBlobUrl ?? ''}
                                        alt={previewEntry.name}
                                        style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8 }}
                                    />
                                    <Button
                                        leftSection={<IconDownload size={16} />}
                                        onClick={() => previewEntry && handleDownload(previewEntry)}
                                    >
                                        ダウンロード
                                    </Button>
                                </Stack>
                            ) : previewEntry?.mime === 'application/pdf' ? (
                                <Stack align="center" gap="md">
                                    <canvas
                                        ref={pdfCanvasRef}
                                        style={{ maxWidth: '100%', border: '1px solid #dee2e6', borderRadius: 4 }}
                                    />
                                    <Group gap="sm">
                                        <Button
                                            variant="default"
                                            size="sm"
                                            disabled={pdfPageNum <= 1}
                                            onClick={() => handlePdfPageChange(pdfPageNum - 1)}
                                        >
                                            ◀ 前のページ
                                        </Button>
                                        <Text size="sm">{pdfPageNum} / {pdfTotalPages}</Text>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            disabled={pdfPageNum >= pdfTotalPages}
                                            onClick={() => handlePdfPageChange(pdfPageNum + 1)}
                                        >
                                            次のページ ▶
                                        </Button>
                                        <Button
                                            leftSection={<IconDownload size={16} />}
                                            size="sm"
                                            onClick={() => previewEntry && handleDownload(previewEntry)}
                                        >
                                            ダウンロード
                                        </Button>
                                    </Group>
                                </Stack>
                            ) : null}
                        </Modal>
                    </Container>
                </AppShell.Main>
            </AppShell>
        </>
    );
}
