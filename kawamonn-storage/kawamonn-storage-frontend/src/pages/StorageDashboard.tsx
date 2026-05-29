import { useEffect, useState, useRef } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text, Card, Grid,
    ActionIcon, TextInput, Breadcrumbs, Anchor, Center, Textarea,
    Stack, Burger, Drawer, Divider, Progress, AspectRatio, Menu, Modal
} from '@mantine/core';
import {
    IconUpload, IconFolder, IconFolderPlus, IconFileText, IconTerminal2, IconEdit,
    IconPlus, IconDownload, IconTrash, IconChevronRight, IconFile, IconFileZip, IconFileCode, IconPhoto, IconSettings, IconDotsVertical, IconFilePlus
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useDisclosure } from '@mantine/hooks';
import axios from 'axios';
import * as pdfjsLib from 'pdfjs-dist';
import { useAuth } from '../App';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

interface FileItem {
    id: string;
    name: string;
    size: string;
    mime_type: string;
    created_at: string;
    parent_id: string | null;
}

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
// FileCard component (top-level, not nested)
// Loads thumbnails via axios (auth header) → blob URL
// -----------------------------------------------
interface FileCardProps {
    file: FileItem;
    onNavigate: (id: string, name: string) => void;
    onDownload: (file: FileItem) => void;
    onDelete: (file: FileItem) => void;
}

// -----------------------------------------------
// FolderCard component (Google Drive Style)
// -----------------------------------------------
function FolderCard({ file, onNavigate, onDelete }: FileCardProps) {
    return (
        <Grid.Col span={{ base: 12, sm: 6, md: 4, lg: 3 }}>
            <Card
                shadow="xs"
                padding="sm"
                radius="md"
                withBorder
                style={{ cursor: 'pointer', transition: 'background-color 0.2s ease' }}
                onClick={() => onNavigate(file.id, file.name)}
                className="folder-card"
            >
                <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ overflow: 'hidden' }}>
                        <IconFolder size={24} color="#4dabf7" style={{ flexShrink: 0 }} />
                        <Text fw={500} size="sm" truncate>
                            {file.name}
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
                                onClick={(e) => { e.stopPropagation(); onDelete(file); }}
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
// FileCard component (updated Google Drive Style)
// -----------------------------------------------
interface FileCardPropsExt extends Omit<FileCardProps, 'onNavigate'> {
    onEdit?: (file: FileItem) => void;
}

function FileCard({ file, onDownload, onDelete, onEdit }: FileCardPropsExt) {
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;

        const loadThumb = async () => {
            const isImage = file.mime_type.startsWith('image/');
            const isPdf = file.mime_type === 'application/pdf';
            if (!isImage && !isPdf) return;

            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(`/api/v1/files/${file.id}/stream`, {
                    headers: { Authorization: `Bearer ${token}` },
                    responseType: 'arraybuffer',
                });
                if (cancelled) return;

                if (isImage) {
                    const blob = new Blob([response.data], { type: file.mime_type });
                    objectUrl = URL.createObjectURL(blob);
                    setThumbUrl(objectUrl);
                } else if (isPdf) {
                    const pdf = await pdfjsLib.getDocument({ data: response.data }).promise;
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
    }, [file.id, file.mime_type]);

    return (
        <Grid.Col span={{ base: 6, sm: 4, md: 3, lg: 2, xl: 2 }}>
            <Card
                shadow="xs"
                padding={0}
                radius="md"
                withBorder
                h="100%"
                style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
                onClick={() => {
                    const isEditable = file.mime_type.startsWith('text/') || ['application/json', 'application/javascript'].includes(file.mime_type) || file.name.match(/\.(md|ts|py|sh|env|cfg|conf|yaml|yml)$/);
                    if (isEditable && onEdit) onEdit(file);
                    else if (!isEditable) onDownload(file);
                }}
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
                                alt={file.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        ) : (
                            <Center style={{ width: '100%', height: '100%' }}>
                                {getFileIcon(file.mime_type, 64)}
                            </Center>
                        )}
                    </AspectRatio>
                </Card.Section>

                {/* Name & meta */}
                <Group justify="space-between" wrap="nowrap" p="xs" style={{ flexGrow: 1, alignItems: 'flex-start' }}>
                    <Stack gap={2} style={{ overflow: 'hidden' }}>
                        <Text fw={500} size="sm" truncate title={file.name}>
                            {file.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {`${(Number(file.size) / 1024 / 1024).toFixed(2)} MB`}
                        </Text>
                    </Stack>
                    <Menu shadow="md" width={140} position="bottom-end" withinPortal>
                        <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" size="sm">
                                <IconDotsVertical size={16} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item
                                leftSection={<IconDownload size={14} />}
                                onClick={() => onDownload(file)}
                            >
                                ダウンロード
                            </Menu.Item>
                            <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={14} />}
                                onClick={() => onDelete(file)}
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
    const [files, setFiles] = useState<FileItem[]>([]);
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
    const [path, setPath] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'マイファイル' }]);
    const [loading, setLoading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);

    const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
    const [folderModalOpened, { open: openFolderModal, close: closeFolderModal }] = useDisclosure(false);
    const [newFolderName, setNewFolderName] = useState('');

    const [newFileModalOpened, { open: openNewFileModal, close: closeNewFileModal }] = useDisclosure(false);
    const [newFileName, setNewFileName] = useState('');

    const [editorOpened, { open: openEditor, close: closeEditor }] = useDisclosure(false);
    const [editorContent, setEditorContent] = useState('');
    const [editorFile, setEditorFile] = useState<FileItem | null>(null);
    const [editorLoading, setEditorLoading] = useState(false);
    const [editorSaving, setEditorSaving] = useState(false);

    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const { logout } = useAuth();

    useEffect(() => { fetchFiles(); }, [currentFolderId]);

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const pid = currentFolderId ?? 'null';
            const res = await axios.get(`/api/v1/files?parent_id=${pid}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setFiles(res.data.items ?? []);
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 401) navigate('/login');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        try {
            const token = localStorage.getItem('token');
            await axios.post('/api/v1/files/folder',
                { name: newFolderName.trim(), parent_id: currentFolderId },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setNewFolderName('');
            closeFolderModal();
            fetchFiles();
        } catch (err) {
            console.error('Folder creation failed', err);
            alert('フォルダの作成に失敗しました');
        }
    };

    const handleCreateFile = async () => {
        if (!newFileName.trim()) return;
        try {
            const token = localStorage.getItem('token');
            const res = await axios.post('/api/v1/files/text',
                { name: newFileName.trim(), content: '', parent_id: currentFolderId },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setNewFileName('');
            closeNewFileModal();
            fetchFiles();
            // Open newly created file in editor
            handleEditFile(res.data);
        } catch (err) {
            console.error('File creation failed', err);
            alert('ファイルの作成に失敗しました');
        }
    };

    const handleEditFile = async (file: FileItem) => {
        setEditorFile(file);
        setEditorContent('');
        setEditorLoading(true);
        openEditor();
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`/api/v1/files/${file.id}/stream`, {
                headers: { Authorization: `Bearer ${token}` },
                responseType: 'text',
                transformResponse: [(data) => data],
            });
            setEditorContent(res.data);
        } catch (err) {
            console.error('Failed to load file content', err);
            alert('ファイルの読み込みに失敗しました');
            closeEditor();
        } finally {
            setEditorLoading(false);
        }
    };


    const handleSaveFile = async () => {
        if (!editorFile) return;
        setEditorSaving(true);
        try {
            const token = localStorage.getItem('token');
            await axios.put(`/api/v1/files/${editorFile.id}/content`,
                { content: editorContent },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            closeEditor();
            fetchFiles();
        } catch (err) {
            console.error('Failed to save file', err);
            alert('保存に失敗しました');
        } finally {
            setEditorSaving(false);
        }
    };

    const uploadSingleFile = async (file: File, parentId: string | null) => {
        const token = localStorage.getItem('token');
        const formData = new FormData();
        formData.append('file', file);
        if (parentId) formData.append('parent_id', parentId);
        await axios.post('/api/v1/files', formData, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'multipart/form-data'
            }
        });
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        if (!files.length) return;
        event.target.value = '';

        setUploadProgress(0);
        let done = 0;
        const errors: string[] = [];

        for (const file of files) {
            try {
                await uploadSingleFile(file, currentFolderId);
            } catch {
                errors.push(file.name);
            }
            done++;
            setUploadProgress(Math.round((done / files.length) * 100));
        }

        setUploadProgress(null);
        if (errors.length) alert(`以下のファイルのアップロードに失敗しました:\n${errors.join('\n')}`);
        fetchFiles();
    };

    // Folder upload: recreate directory structure under current folder
    const handleFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        if (!files.length) return;
        event.target.value = '';

        setUploadProgress(0);
        const token = localStorage.getItem('token');
        // Map from relative dir path → folder id in DB
        const dirMap: Record<string, string> = {};
        let done = 0;

        // Sort so parent dirs come before children
        const sorted = [...files].sort((a, b) =>
            (a.webkitRelativePath || '').localeCompare(b.webkitRelativePath || '')
        );

        for (const file of sorted) {
            // e.g. "MyFolder/subdir/file.txt"
            const parts = file.webkitRelativePath.split('/');
            // parts = ['MyFolder', ...(subdirs)..., 'filename']
            // Ensure each directory in the path exists
            for (let i = 0; i < parts.length - 1; i++) {
                const parentPath = parts.slice(0, i).join('/');
                const dirPath = parts.slice(0, i + 1).join('/');

                if (!dirMap[dirPath]) {
                    const parentId = i === 0 ? currentFolderId : dirMap[parentPath];
                    try {
                        const res = await axios.post('/api/v1/files/folder',
                            { name: parts[i], parent_id: parentId },
                            { headers: { Authorization: `Bearer ${token}` } }
                        );
                        dirMap[dirPath] = res.data.id;
                    } catch (e: any) {
                        console.error('Dir create failed', e);
                    }
                }
            }

            // Upload the file into its deepest folder
            const fileDirPath = parts.slice(0, parts.length - 1).join('/');
            const fileParentId = dirMap[fileDirPath] || currentFolderId;
            try {
                await uploadSingleFile(file, fileParentId);
            } catch (e) {
                console.error('File upload failed', e);
            }
            done++;
            setUploadProgress(Math.round((done / sorted.length) * 100));
        }

        setUploadProgress(null);
        fetchFiles();
    };

    const handleDownload = async (file: FileItem) => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`/api/v1/files/${file.id}/download`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            window.open(res.data.url, '_blank');
        } catch { /* silent */ }
    };

    const handleDelete = async (file: FileItem) => {
        const label = file.mime_type === 'directory' ? 'フォルダ' : 'ファイル';
        if (!window.confirm(`"${file.name}" を削除しますか？${file.mime_type === 'directory' ? '\n※ フォルダ内のファイルも全て削除されます。' : ''}`)) return;
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`/api/v1/files/${file.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchFiles();
        } catch (err) {
            alert(`${label}の削除に失敗しました`);
        }
    };

    const navigateToFolder = (id: string | null, name: string) => {
        if (id === currentFolderId) return;
        if (id === null) {
            setPath([{ id: null, name: 'マイファイル' }]);
        } else {
            const idx = path.findIndex(p => p.id === id);
            setPath(idx !== -1 ? path.slice(0, idx + 1) : [...path, { id, name }]);
        }
        setCurrentFolderId(id);
    };

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
                    onClick={() => { openFolderModal(); closeDrawer(); }}
                >
                    新規フォルダを作成
                </Button>
                <Button
                    variant="light"
                    color="cyan"
                    leftSection={<IconFilePlus size={16} />}
                    fullWidth
                    onClick={() => { openNewFileModal(); closeDrawer(); }}
                >
                    新規ファイルを作成
                </Button>
                <Divider my="xs" />
                <Button
                    variant={currentFolderId === null ? 'light' : 'subtle'}
                    leftSection={<IconFolder size={16} />}
                    fullWidth
                    justify="flex-start"
                    onClick={() => { navigateToFolder(null, 'マイファイル'); closeDrawer(); }}
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
                // @ts-ignore – webkitdirectory is non-standard but widely supported
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
                            {localStorage.getItem('role') === 'admin' && (
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
                                {path.map((p, i) => (
                                    <Anchor
                                        key={i}
                                        size="sm"
                                        onClick={() => navigateToFolder(p.id, p.name)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {p.name}
                                    </Anchor>
                                ))}
                            </Breadcrumbs>
                        </Group>

                        {/* File grid */}
                        {loading ? (
                            <Center py="xl"><Text c="dimmed">読み込み中...</Text></Center>
                        ) : files.length === 0 ? (
                            <Center py="xl">
                                <Stack align="center" gap="xs">
                                    <IconFolder size={64} color="lightgray" />
                                    <Text c="dimmed">ファイルはありません</Text>
                                </Stack>
                            </Center>
                        ) : (
                            <>
                                {/* Folders Section */}
                                {files.filter(f => f.mime_type === 'directory').length > 0 && (
                                    <>
                                        <Text fw={600} size="sm" mb="sm" c="dimmed">フォルダ</Text>
                                        <Grid gutter="md" mb="xl">
                                            {files.filter(f => f.mime_type === 'directory').map(file => (
                                                <FolderCard
                                                    key={file.id}
                                                    file={file}
                                                    onNavigate={navigateToFolder}
                                                    onDelete={handleDelete}
                                                    onDownload={handleDownload} // Required by type, though not used for folders
                                                />
                                            ))}
                                        </Grid>
                                    </>
                                )}

                                {/* Files Section */}
                                {files.filter(f => f.mime_type !== 'directory').length > 0 && (
                                    <>
                                        <Text fw={600} size="sm" mb="sm" c="dimmed">ファイル</Text>
                                        <Grid gutter="md">
                                            {files.filter(f => f.mime_type !== 'directory').map(file => (
                                                <FileCard
                                                    key={file.id}
                                                    file={file}
                                                    onDownload={handleDownload}
                                                    onDelete={handleDelete}
                                                    onEdit={handleEditFile}
                                                />
                                            ))}
                                        </Grid>
                                    </>
                                )}
                            </>
                        )}

                        {/* Inline "New Folder" form — no Modal/portal, no z-index issues */}
                        {folderModalOpened && (
                            <Card withBorder shadow="sm" radius="md" p="md" mb="md" style={{ maxWidth: 360 }}>
                                <Group justify="space-between" mb="xs">
                                    <Text fw={600} size="sm">新規フォルダを作成</Text>
                                    <ActionIcon variant="subtle" onClick={closeFolderModal} size="sm">
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
                                    <Button size="sm" variant="subtle" color="gray" onClick={closeFolderModal}>
                                        キャンセル
                                    </Button>
                                </Group>
                            </Card>
                        )}
                        {/* Inline "New File" form */}
                        {newFileModalOpened && (
                            <Card withBorder shadow="sm" radius="md" p="md" mb="md" style={{ maxWidth: 360 }}>
                                <Group justify="space-between" mb="xs">
                                    <Text fw={600} size="sm">新規テキストファイルを作成</Text>
                                    <ActionIcon variant="subtle" onClick={closeNewFileModal} size="sm">
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
                                    <Button size="sm" variant="subtle" color="gray" onClick={closeNewFileModal}>
                                        キャンセル
                                    </Button>
                                </Group>
                            </Card>
                        )}
                        
                        {/* Editor Modal */}
                        <Modal
                            opened={editorOpened}
                            onClose={closeEditor}
                            title={editorFile?.name}
                            size="lg"
                            fullScreen={window.innerWidth < 768}
                            styles={{
                                title: { fontWeight: 600 },
                                content: { background: '#161b22', color: '#e6edf3' },
                                header: { background: '#161b22' }
                            }}
                        >
                            {editorLoading ? (
                                <Center h={300}><Progress value={100} animated style={{ width: '80%' }} /></Center>
                            ) : (
                                <Stack>
                                    <Textarea
                                        value={editorContent}
                                        onChange={(e) => setEditorContent(e.currentTarget.value)}
                                        styles={{
                                            input: {
                                                fontFamily: 'monospace',
                                                height: '60vh',
                                                background: '#0d1117',
                                                color: '#e6edf3',
                                                border: '1px solid #30363d'
                                            }
                                        }}
                                    />
                                    <Group justify="flex-end">
                                        <Button variant="default" onClick={closeEditor}>キャンセル</Button>
                                        <Button color="blue" onClick={handleSaveFile} loading={editorSaving}>保存</Button>
                                    </Group>
                                </Stack>
                            )}
                        </Modal>
                    </Container>
                </AppShell.Main>
            </AppShell>
        </>
    );
}
