import { useEffect, useRef, useState, useCallback } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text, Badge,
    Card, Stack, Loader, Alert, Grid, Progress, Tooltip, ActionIcon,
    ScrollArea, TextInput, Modal, Menu, Textarea,
} from '@mantine/core';
import {
    IconTerminal2, IconPlayerPlay, IconPlayerStop, IconRefresh,
    IconAlertCircle, IconArrowLeft, IconCpu, IconDeviceFloppy,
    IconPlugConnected, IconPlugConnectedX, IconFolder, IconFile,
    IconUpload, IconFolderPlus, IconTrash, IconEdit, IconDownload,
    IconChevronRight, IconHome, IconDots, IconFilePlus, IconCheck, IconFileText,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import axios from 'axios';
import { useAuth } from '../App';

type SessionState = 'idle' | 'starting' | 'connected' | 'disconnecting' | 'error';

interface SshStatus {
    container_status: string;
    ssh_port: string | null;
    resource_usage: { cpu_limit: string; memory_limit: string };
}

interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    mtime: string;
}

// ─────────────────────────────────────────────
// ファイルサイズのフォーマット
// ─────────────────────────────────────────────
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// 自動リトライ用ヘルパー追加部分
const fetchWithRetry = async <T,>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> => {
    try {
        return await fn();
    } catch (e: any) {
        // 400系エラー(404など)はリトライしない
        if (retries <= 0 || (e.response && e.response.status >= 400 && e.response.status < 500 && e.response.status !== 429)) {
            throw e;
        }
        await new Promise(r => setTimeout(r, delayMs));
        return fetchWithRetry(fn, retries - 1, delayMs * 1.5);
    }
};

// ─────────────────────────────────────────────
// ファイルブラウザコンポーネント
// ─────────────────────────────────────────────
function FileBrowser() {
    const [currentPath, setCurrentPath] = useState('/');
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // フォルダ作成
    const [newFolderModal, setNewFolderModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    // 名前変更
    const [renameModal, setRenameModal] = useState(false);
    const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
    const [renameName, setRenameName] = useState('');
    // ファイルエディタ
    const [editorModal, setEditorModal] = useState(false);
    const [editorPath, setEditorPath] = useState('');
    const [editorContent, setEditorContent] = useState('');
    const [editorLoading, setEditorLoading] = useState(false);
    const [editorSaving, setEditorSaving] = useState(false);
    const [editorIsNew, setEditorIsNew] = useState(false);
    // 新規ファイル作成
    const [newFileModal, setNewFileModal] = useState(false);
    const [newFileName, setNewFileName] = useState('');

    const uploadRef = useRef<HTMLInputElement>(null);
    const editorTextareaRef = useRef<HTMLTextAreaElement>(null);

    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    const fetchDir = useCallback(async (path: string) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetchWithRetry(() => axios.get('/api/v1/filebrowser/ls', {
                headers,
                params: { path },
            }));
            setEntries(res.data.entries);
            setCurrentPath(path);
        } catch (e: any) {
            setError(e.response?.data?.message || 'ディレクトリを取得できませんでした');
        } finally {
            setLoading(false);
        }
    }, [headers]);

    useEffect(() => { fetchDir('/'); }, [fetchDir]);

    // パンくずリスト生成
    const breadcrumbs = currentPath === '/'
        ? [{ label: 'Home', path: '/' }]
        : [
            { label: 'Home', path: '/' },
            ...currentPath.split('/').filter(Boolean).map((part, i, arr) => ({
                label: part,
                path: '/' + arr.slice(0, i + 1).join('/'),
            })),
        ];

    const navigateUp = () => {
        if (currentPath === '/') return;
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        fetchDir(parent);
    };

    const handleDownload = async (entry: FileEntry) => {
        try {
            const res = await axios.get('/api/v1/filebrowser/read', {
                headers,
                params: { path: entry.path },
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = entry.name;
            link.click();
            window.URL.revokeObjectURL(url);
        } catch (e: any) {
            setError('ダウンロードに失敗しました');
        }
    };

    const handleDelete = async (entry: FileEntry) => {
        if (!window.confirm(`「${entry.name}」を削除しますか？`)) return;
        try {
            await axios.delete('/api/v1/filebrowser/delete', { headers, params: { path: entry.path } });
            fetchDir(currentPath);
        } catch (e: any) {
            setError(e.response?.data?.message || '削除に失敗しました');
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const formData = new FormData();
        formData.append('file', files[0]);
        try {
            await axios.post('/api/v1/filebrowser/upload', formData, {
                headers: { ...headers, 'Content-Type': 'multipart/form-data' },
                params: { path: currentPath },
            });
            fetchDir(currentPath);
        } catch (e: any) {
            setError(e.response?.data?.message || 'アップロードに失敗しました');
        }
        e.target.value = '';
    };

    const handleMkdir = async () => {
        if (!newFolderName.trim()) return;
        const newPath = `${currentPath === '/' ? '' : currentPath}/${newFolderName.trim()}`;
        try {
            await axios.post('/api/v1/filebrowser/mkdir', { path: newPath }, { headers });
            setNewFolderModal(false);
            setNewFolderName('');
            fetchDir(currentPath);
        } catch (e: any) {
            setError(e.response?.data?.message || 'フォルダ作成に失敗しました');
        }
    };

    const openRename = (entry: FileEntry) => {
        setRenameTarget(entry);
        setRenameName(entry.name);
        setRenameModal(true);
    };

    const handleRename = async () => {
        if (!renameTarget || !renameName.trim()) return;
        const parentDir = renameTarget.path.split('/').slice(0, -1).join('/') || '/';
        const newPath = `${parentDir === '/' ? '' : parentDir}/${renameName.trim()}`;
        try {
            await axios.patch('/api/v1/filebrowser/rename', {
                oldPath: renameTarget.path,
                newPath,
            }, { headers });
            setRenameModal(false);
            setRenameTarget(null);
            fetchDir(currentPath);
        } catch (e: any) {
            setError(e.response?.data?.message || '名前変更に失敗しました');
        }
    };

    // テキストファイルをエディタで開く
    const EDITABLE_EXTS = new Set(['.txt', '.md', '.sh', '.py', '.js', '.ts', '.json', '.yaml', '.yml',
        '.toml', '.ini', '.conf', '.cfg', '.env', '.csv', '.xml', '.html', '.css', '.c', '.cpp',
        '.java', '.go', '.rs', '.rb', '.pl', '.sql', '.tf', '']);

    const isEditable = (name: string) => {
        const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
        return EDITABLE_EXTS.has(ext);
    };

    const openEditor = async (entry: FileEntry) => {
        setEditorPath(entry.path);
        setEditorIsNew(false);
        setEditorLoading(true);
        setEditorModal(true);
        setEditorContent('');
        try {
            const res = await fetchWithRetry(() => axios.get('/api/v1/filebrowser/read', {
                headers,
                params: { path: entry.path },
                responseType: 'text',
                transformResponse: [(data) => data],  // JSON パースをバイパス
            }));
            setEditorContent(res.data);
        } catch (e: any) {
            setError(e.response?.data?.message || 'ファイルを読み込めませんでした(自動復旧に失敗しました)');
            setEditorModal(false);
        } finally {
            setEditorLoading(false);
        }
    };

    const handleEditorSave = async () => {
        setEditorSaving(true);
        try {
            await axios.put('/api/v1/filebrowser/write-text',
                { path: editorPath, content: editorContent },
                { headers }
            );
            setEditorModal(false);
            fetchDir(currentPath);
        } catch (e: any) {
            setError(e.response?.data?.message || '保存に失敗しました');
        } finally {
            setEditorSaving(false);
        }
    };

    // エディタのキーボードハンドラー（nano風）
    const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Tab キー: フォーカス移動ではなくスペース挿入
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = editorTextareaRef.current;
            if (!ta) return;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const spaces = '    '; // 4スペース
            const newContent = editorContent.substring(0, start) + spaces + editorContent.substring(end);
            setEditorContent(newContent);
            // カーソル位置をスペース挿入後に移動
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + spaces.length;
            });
            return;
        }
        // Ctrl+S: 保存
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleEditorSave();
            return;
        }
        // Ctrl+X: 閉じる
        if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
            e.preventDefault();
            setEditorModal(false);
            return;
        }
    };

    const openNewFile = () => {
        setNewFileName('');
        setNewFileModal(true);
    };

    const handleCreateNewFile = () => {
        if (!newFileName.trim()) return;
        const relPath = `${currentPath === '/' ? '' : currentPath}/${newFileName.trim()}`;
        setNewFileModal(false);
        // 空のエディタを開く
        setEditorPath(relPath);
        setEditorContent('');
        setEditorIsNew(true);
        setEditorLoading(false);
        setEditorModal(true);
    };

    return (
        <Stack gap={0} style={{ height: '100%' }}>
            {/* パンくずリスト */}
            <Group
                px="sm"
                py={5}
                style={{ borderBottom: '1px solid #30363d', background: '#0d1117', flexShrink: 0 }}
            >
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => fetchDir('/')} title="ホームへ">
                    <IconHome size={12} />
                </ActionIcon>
                {breadcrumbs.map((crumb, i) => (
                    <Group key={crumb.path} gap={2} wrap="nowrap">
                        {i > 0 && <IconChevronRight size={9} color="#484f58" />}
                        <Text
                            size="xs"
                            c={i === breadcrumbs.length - 1 ? 'white' : 'blue'}
                            style={{ cursor: i === breadcrumbs.length - 1 ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                            onClick={() => i < breadcrumbs.length - 1 && fetchDir(crumb.path)}
                        >
                            {crumb.label}
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
                    id="fb-refresh-btn"
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconUpload size={12} />}
                    onClick={() => uploadRef.current?.click()}
                >
                    アップロード
                </Button>
                <input id="fb-upload-input" ref={uploadRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => fetchDir(currentPath)} title="再読み込み" style={{ marginLeft: 'auto' }}>
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
                        {entries.map(entry => (
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
                                onMouseEnter={e => (e.currentTarget.style.background = '#161b22')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                onClick={() => {
                                    if (entry.isDir) {
                                        fetchDir(entry.path);
                                    } else if (isEditable(entry.name)) {
                                        openEditor(entry);
                                    }
                                }}
                            >
                                <Group gap="xs" wrap="nowrap" style={{ overflow: 'hidden', flex: 1 }}>
                                    {entry.isDir
                                        ? <IconFolder size={14} color="#58a6ff" style={{ flexShrink: 0 }} />
                                        : isEditable(entry.name)
                                            ? <IconFileText size={14} color="#3fb950" style={{ flexShrink: 0 }} />
                                            : <IconFile size={14} color="#8b949e" style={{ flexShrink: 0 }} />
                                    }
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
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <IconDots size={12} />
                                            </ActionIcon>
                                        </Menu.Target>
                                        <Menu.Dropdown style={{ background: '#161b22', border: '1px solid #30363d' }}>
                                            {!entry.isDir && isEditable(entry.name) && (
                                                <Menu.Item
                                                    leftSection={<IconEdit size={13} />}
                                                    onClick={e => { e.stopPropagation(); openEditor(entry); }}
                                                    style={{ color: '#e6edf3', fontSize: 12 }}
                                                >
                                                    編集
                                                </Menu.Item>
                                            )}
                                            {!entry.isDir && (
                                                <Menu.Item
                                                    leftSection={<IconDownload size={13} />}
                                                    onClick={e => { e.stopPropagation(); handleDownload(entry); }}
                                                    style={{ color: '#e6edf3', fontSize: 12 }}
                                                >
                                                    ダウンロード
                                                </Menu.Item>
                                            )}
                                            <Menu.Item
                                                leftSection={<IconEdit size={13} />}
                                                onClick={e => { e.stopPropagation(); openRename(entry); }}
                                                style={{ color: '#e6edf3', fontSize: 12 }}
                                            >
                                                名前変更
                                            </Menu.Item>
                                            <Menu.Item
                                                leftSection={<IconTrash size={13} />}
                                                color="red"
                                                onClick={e => { e.stopPropagation(); handleDelete(entry); }}
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
                        onChange={e => setNewFolderName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleMkdir()}
                        styles={{ input: { background: '#0d1117', borderColor: '#30363d', color: 'white' } }}
                        autoFocus
                    />
                    <Button onClick={handleMkdir} color="blue" disabled={!newFolderName.trim()}>作成</Button>
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
                        onChange={e => setRenameName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleRename()}
                        styles={{ input: { background: '#0d1117', borderColor: '#30363d', color: 'white' } }}
                        autoFocus
                    />
                    <Button onClick={handleRename} color="blue" disabled={!renameName.trim()}>変更</Button>
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
                        onChange={e => setNewFileName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCreateNewFile()}
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

            {/* テキストエディタモーダル (nano風) */}
            <Modal
                opened={editorModal}
                onClose={() => setEditorModal(false)}
                title={
                    <Group gap="xs">
                        <IconFileText size={14} color="#58a6ff" />
                        <Text size="sm" c="white" style={{ fontFamily: 'monospace' }}>
                            GNU nano — {editorPath.split('/').pop()}
                        </Text>
                        {editorIsNew && <Badge size="xs" color="teal">新規</Badge>}
                    </Group>
                }
                size="xl"
                closeButtonProps={{ tabIndex: -1 }}
                styles={{
                    content: { background: '#0d1117', border: '1px solid #30363d' },
                    header: { background: '#161b22', borderBottom: '1px solid #30363d' },
                }}
            >
                <Stack gap={0}>
                    {editorLoading ? (
                        <Stack align="center" py="xl">
                            <Loader size="sm" color="blue" />
                            <Text size="xs" c="dimmed">読み込んでいます...</Text>
                        </Stack>
                    ) : (
                        <textarea
                            ref={editorTextareaRef}
                            value={editorContent}
                            onChange={e => setEditorContent(e.target.value)}
                            onKeyDown={handleEditorKeyDown}
                            rows={22}
                            style={{
                                width: '100%',
                                background: '#010409',
                                border: '1px solid #30363d',
                                borderRadius: 4,
                                color: '#e6edf3',
                                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                                fontSize: 13,
                                lineHeight: 1.6,
                                resize: 'vertical',
                                padding: '8px 10px',
                                outline: 'none',
                                boxSizing: 'border-box',
                                tabSize: 4,
                            }}
                            placeholder="ファイルの内容を入力..."
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                        />
                    )}

                    {/* nano風ショートカットバー */}
                    <div style={{
                        background: '#161b22',
                        borderTop: '1px solid #30363d',
                        padding: '6px 10px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4px 16px',
                        marginTop: 6,
                        borderRadius: '0 0 4px 4px',
                    }}>
                        {[
                            { key: '^O', label: '保存 (Ctrl+S)' },
                            { key: '^X', label: '閉じる (Ctrl+X)' },
                            { key: 'Tab', label: 'インデント (4sp)' },
                        ].map(({ key, label }) => (
                            <Group key={key} gap={4} wrap="nowrap">
                                <Text
                                    size="xs"
                                    style={{
                                        background: '#30363d',
                                        color: '#e6edf3',
                                        fontFamily: 'monospace',
                                        padding: '1px 5px',
                                        borderRadius: 3,
                                        fontWeight: 600,
                                        fontSize: 11,
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {key}
                                </Text>
                                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{label}</Text>
                            </Group>
                        ))}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                            <Button
                                variant="subtle"
                                color="gray"
                                size="xs"
                                onClick={() => setEditorModal(false)}
                                tabIndex={-1}
                            >
                                キャンセル
                            </Button>
                            <Button
                                color="blue"
                                size="xs"
                                leftSection={<IconCheck size={13} />}
                                onClick={handleEditorSave}
                                loading={editorSaving}
                                disabled={editorLoading}
                                tabIndex={-1}
                            >
                                保存
                            </Button>
                        </div>
                    </div>

                    <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', marginTop: 4 }}>
                        {editorPath}
                    </Text>
                </Stack>
            </Modal>
        </Stack>
    );
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────
export default function SshDashboard() {
    const navigate = useNavigate();
    const { logout } = useAuth();

    // ターミナル状態
    const [sessionState, setSessionState] = useState<SessionState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [containerStatus, setContainerStatus] = useState<SshStatus | null>(null);

    // refs
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    // ----------------------------------------------
    // コンテナステータス取得
    // ----------------------------------------------
    const fetchStatus = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const username = localStorage.getItem('account_name');
            if (!username) return;
            const res = await axios.get(`/api/v1/ssh/status/${username}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setContainerStatus(res.data);
        } catch (err: any) {
            if (err.response?.status !== 404) {
                console.error('Failed to fetch SSH status');
            }
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    // ----------------------------------------------
    // xterm.js の初期化（DOM mount 後に1回だけ）
    // ----------------------------------------------
    const initTerminal = useCallback(() => {
        if (!terminalRef.current || xtermRef.current) return;

        const term = new Terminal({
            theme: {
                background: '#0d1117',
                foreground: '#e6edf3',
                cursor: '#58a6ff',
                cursorAccent: '#0d1117',
                black: '#484f58',
                red: '#ff7b72',
                green: '#3fb950',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#39c5cf',
                white: '#b1bac4',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#56d4dd',
                brightWhite: '#f0f6fc',
            },
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
            fontSize: 14,
            lineHeight: 1.4,
            cursorStyle: 'block',
            cursorBlink: true,
            convertEol: true,
            scrollback: 5000,
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        term.open(terminalRef.current);

        setTimeout(() => fitAddon.fit(), 50);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // ターミナルリサイズ監視
        const ro = new ResizeObserver(() => {
            try { fitAddon.fit(); } catch (_) {}
            if (socketRef.current?.connected && xtermRef.current) {
                socketRef.current.emit('resize', {
                    cols: xtermRef.current.cols,
                    rows: xtermRef.current.rows,
                });
            }
        });
        ro.observe(terminalRef.current);
        resizeObserverRef.current = ro;
    }, []);

    // セッション状態が "starting" 以降になったらterminalDivをマウントするので、
    // そのタイミングでxtermを初期化する
    useEffect(() => {
        if (sessionState === 'starting' || sessionState === 'connected') {
            // 少し待ってからDOMが確実にあることを確認
            const timer = setTimeout(initTerminal, 100);
            return () => clearTimeout(timer);
        }
    }, [sessionState, initTerminal]);

    // ----------------------------------------------
    // アンマウント時クリーンアップ
    // ----------------------------------------------
    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
            socketRef.current?.disconnect();
            xtermRef.current?.dispose();
        };
    }, []);

    // ----------------------------------------------
    // WebSocket 接続＆ターミナル起動
    // ----------------------------------------------
    const handleLaunch = useCallback(async () => {
        setSessionState('starting');
        setErrorMsg('');

        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login');
            return;
        }

        // Socket.io 接続
        const socket = io('/terminal', {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: false,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            // 接続成功後にターミナル開始イベント送信
            const cols = xtermRef.current?.cols || 80;
            const rows = xtermRef.current?.rows || 24;
            socket.emit('start', { cols, rows });
        });

        socket.on('ready', () => {
            setSessionState('connected');
            fetchStatus();

            // キー入力をコンテナに送信
            xtermRef.current?.onData((data) => {
                socket.emit('input', { input: data });
            });
        });

        socket.on('output', (data: string) => {
            xtermRef.current?.write(data);
        });

        socket.on('session_ended', () => {
            setSessionState('idle');
            xtermRef.current?.writeln('\r\n\x1b[33m[Session ended. Press "Launch Terminal" to reconnect.]\x1b[0m');
        });

        socket.on('error', (err: { message: string }) => {
            setErrorMsg(err.message || 'Connection error');
            setSessionState('error');
        });

        socket.on('connect_error', (err) => {
            setErrorMsg(`Connection failed: ${err.message}`);
            setSessionState('error');
        });

        socket.on('disconnect', (reason) => {
            if (sessionState === 'connected') {
                xtermRef.current?.writeln(`\r\n\x1b[31m[Disconnected: ${reason}]\x1b[0m`);
            }
            setSessionState('idle');
        });
    }, [navigate, fetchStatus, sessionState]);

    // ----------------------------------------------
    // セッション切断
    // ----------------------------------------------
    const handleDisconnect = useCallback(() => {
        setSessionState('disconnecting');
        if (socketRef.current) {
            socketRef.current.emit('disconnect_session');
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        setSessionState('idle');
    }, []);

    // ----------------------------------------------
    // UI ヘルパー
    // ----------------------------------------------
    const statusColor: Record<SessionState, string> = {
        idle: 'gray',
        starting: 'yellow',
        connected: 'green',
        disconnecting: 'orange',
        error: 'red',
    };

    const statusLabel: Record<SessionState, string> = {
        idle: 'Offline',
        starting: 'Starting...',
        connected: 'Connected',
        disconnecting: 'Disconnecting...',
        error: 'Error',
    };

    const containerRunning = containerStatus?.container_status === 'running';

    return (
        <AppShell header={{ height: 60 }} padding="md">
            {/* ── Header ── */}
            <AppShell.Header
                style={{
                    background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
                    borderBottom: '1px solid #30363d',
                }}
            >
                <Group h="100%" px="md" justify="space-between">
                    <Group gap="sm">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => navigate('/')}
                            title="戻る"
                        >
                            <IconArrowLeft size={18} />
                        </ActionIcon>
                        <Group gap="xs">
                            <IconTerminal2 size={22} color="#58a6ff" />
                            <Title order={4} c="white">Sandbox Terminal</Title>
                        </Group>
                        <Badge
                            color={statusColor[sessionState]}
                            variant="dot"
                            size="sm"
                        >
                            {statusLabel[sessionState]}
                        </Badge>
                    </Group>
                    <Group gap="sm">
                        <Tooltip label="ステータス更新">
                            <ActionIcon
                                variant="subtle"
                                color="gray"
                                onClick={fetchStatus}
                                disabled={sessionState === 'starting'}
                            >
                                <IconRefresh size={16} />
                            </ActionIcon>
                        </Tooltip>
                        <Button
                            variant="subtle"
                            color="gray"
                            size="xs"
                            onClick={() => navigate('/')}
                        >
                            Storage
                        </Button>
                        <Button
                            variant="light"
                            color="red"
                            size="xs"
                            onClick={() => { logout(); navigate('/login'); }}
                        >
                            Logout
                        </Button>
                    </Group>
                </Group>
            </AppShell.Header>

            {/* ── Main ── */}
            <AppShell.Main
                style={{ background: '#010409', minHeight: 'calc(100vh - 60px)' }}
            >
                <Container size="xl" pt="md">
                    <Grid>
                        {/* 左: リソース情報 + ファイルブラウザ */}
                        <Grid.Col span={{ base: 12, md: 3 }}>
                            <Stack gap="sm">
                                {/* コンテナ情報カード */}
                                <Card
                                    padding="md"
                                    radius="md"
                                    style={{
                                        background: '#161b22',
                                        border: '1px solid #30363d',
                                    }}
                                >
                                    <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb="sm">
                                        Environment
                                    </Text>
                                    <Stack gap="xs">
                                        <Group justify="space-between">
                                            <Text size="sm" c="gray.4">Status</Text>
                                            <Badge
                                                color={containerRunning ? 'green' : 'gray'}
                                                size="sm"
                                                variant="light"
                                            >
                                                {containerStatus?.container_status || 'Not provisioned'}
                                            </Badge>
                                        </Group>

                                        {containerStatus && (
                                            <>
                                                <Group justify="space-between" align="center">
                                                    <Group gap={4}>
                                                        <IconCpu size={14} color="#58a6ff" />
                                                        <Text size="sm" c="gray.4">CPU</Text>
                                                    </Group>
                                                    <Text size="sm" c="white">
                                                        {Number(containerStatus.resource_usage.cpu_limit) * 100}%
                                                    </Text>
                                                </Group>
                                                <Progress
                                                    value={Number(containerStatus.resource_usage.cpu_limit) * 100}
                                                    size="xs"
                                                    color="blue"
                                                    style={{ marginTop: -4 }}
                                                />

                                                <Group justify="space-between" align="center" mt="xs">
                                                    <Group gap={4}>
                                                        <IconDeviceFloppy size={14} color="#3fb950" />
                                                        <Text size="sm" c="gray.4">Memory</Text>
                                                    </Group>
                                                    <Text size="sm" c="white">
                                                        {containerStatus.resource_usage.memory_limit}
                                                    </Text>
                                                </Group>
                                            </>
                                        )}
                                    </Stack>
                                </Card>

                                {/* コントロールボタン */}
                                {sessionState === 'idle' || sessionState === 'error' ? (
                                    <Button
                                        fullWidth
                                        size="md"
                                        color="blue"
                                        variant="filled"
                                        leftSection={<IconPlayerPlay size={18} />}
                                        onClick={handleLaunch}
                                        loading={false}
                                        style={{
                                            background: 'linear-gradient(135deg, #1f6feb, #388bfd)',
                                            boxShadow: '0 0 20px rgba(88, 166, 255, 0.3)',
                                        }}
                                    >
                                        Launch Terminal
                                    </Button>
                                ) : sessionState === 'starting' ? (
                                    <Button fullWidth size="md" variant="light" color="yellow" loading>
                                        Starting...
                                    </Button>
                                ) : (
                                    <Button
                                        fullWidth
                                        size="md"
                                        color="red"
                                        variant="light"
                                        leftSection={<IconPlayerStop size={18} />}
                                        onClick={handleDisconnect}
                                    >
                                        Disconnect
                                    </Button>
                                )}

                                {/* ファイルブラウザカード */}
                                <Card
                                    padding={0}
                                    radius="md"
                                    style={{
                                        background: '#0d1117',
                                        border: '1px solid #30363d',
                                        overflow: 'hidden',
                                        height: 520,
                                        display: 'flex',
                                        flexDirection: 'column',
                                    }}
                                >
                                    {/* カードヘッダー: タイトル + アクションボタン */}
                                    <Group
                                        px="sm"
                                        py={6}
                                        justify="space-between"
                                        style={{ borderBottom: '1px solid #30363d', background: '#161b22', flexShrink: 0 }}
                                    >
                                        <Group gap="xs">
                                            <IconFolder size={13} color="#58a6ff" />
                                            <Text size="xs" c="gray.3" fw={600}>Files</Text>
                                        </Group>
                                        <Group gap={4}>
                                            <Tooltip label="再読み込み">
                                                <ActionIcon size="xs" variant="subtle" color="gray"
                                                    onClick={() => (document.getElementById('fb-refresh-btn') as HTMLButtonElement)?.click()}
                                                >
                                                    <IconRefresh size={11} />
                                                </ActionIcon>
                                            </Tooltip>
                                            <Tooltip label="ファイルをアップロード">
                                                <ActionIcon size="xs" variant="subtle" color="green"
                                                    onClick={() => document.getElementById('fb-upload-input')?.click()}
                                                >
                                                    <IconUpload size={11} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Group>
                                    </Group>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <FileBrowser />
                                    </div>
                                </Card>

                                {/* 環境情報カード */}
                                <Card
                                    padding="md"
                                    radius="md"
                                    style={{
                                        background: '#161b22',
                                        border: '1px solid #30363d',
                                    }}
                                >
                                    <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb="sm">
                                        Installed
                                    </Text>
                                    {[
                                        { label: 'Python 3', color: '#3fb950' },
                                        { label: 'Java 21', color: '#58a6ff' },
                                        { label: 'C / C++', color: '#bc8cff' },
                                        { label: 'C# (.NET 8)', color: '#d29922' },
                                        { label: 'LaTeX', color: '#39c5cf' },
                                        { label: 'Git', color: '#ff7b72' },
                                    ].map(({ label, color }) => (
                                        <Group key={label} gap="xs" mb={4}>
                                            <div style={{
                                                width: 6, height: 6, borderRadius: '50%',
                                                background: color, flexShrink: 0
                                            }} />
                                            <Text size="xs" c="gray.3">{label}</Text>
                                        </Group>
                                    ))}
                                </Card>
                            </Stack>
                        </Grid.Col>

                        {/* 右: ターミナルエリア */}
                        <Grid.Col span={{ base: 12, md: 9 }}>
                            <Card
                                padding={0}
                                radius="md"
                                style={{
                                    background: '#0d1117',
                                    border: `1px solid ${sessionState === 'connected' ? '#238636' : '#30363d'}`,
                                    overflow: 'hidden',
                                    transition: 'border-color 0.3s ease',
                                    boxShadow: sessionState === 'connected'
                                        ? '0 0 30px rgba(35, 134, 54, 0.15)'
                                        : 'none',
                                }}
                            >
                                {/* ターミナルタイトルバー */}
                                <Group
                                    px="md"
                                    py="xs"
                                    style={{
                                        background: '#161b22',
                                        borderBottom: '1px solid #30363d',
                                    }}
                                    justify="space-between"
                                >
                                    <Group gap="sm">
                                        <Group gap={6}>
                                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }} />
                                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }} />
                                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }} />
                                        </Group>
                                        <Text size="xs" c="dimmed" ff="monospace">
                                            {localStorage.getItem('account_name')}@kawamonn-sandbox
                                        </Text>
                                    </Group>
                                    <Group gap="xs">
                                        {sessionState === 'connected' && (
                                            <IconPlugConnected size={14} color="#3fb950" />
                                        )}
                                        {sessionState === 'idle' && (
                                            <IconPlugConnectedX size={14} color="#484f58" />
                                        )}
                                    </Group>
                                </Group>

                                {/* ターミナル本体 */}
                                <div style={{ position: 'relative', minHeight: 480 }}>
                                    {/* xterm.js のマウント先 (常に存在させてxterm初期化を確実にする) */}
                                    <div
                                        ref={terminalRef}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            minHeight: 480,
                                            padding: '8px 4px',
                                            display: (sessionState === 'connected' || sessionState === 'starting') ? 'block' : 'none',
                                        }}
                                    />

                                    {/* 未起動時のオーバーレイ */}
                                    {(sessionState === 'idle' || sessionState === 'error') && (
                                        <Stack
                                            align="center"
                                            justify="center"
                                            style={{ minHeight: 480, padding: 32 }}
                                            gap="lg"
                                        >
                                            <div style={{
                                                width: 80, height: 80, borderRadius: '50%',
                                                background: 'rgba(88,166,255,0.08)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                border: '1px solid rgba(88,166,255,0.2)',
                                            }}>
                                                <IconTerminal2 size={36} color="#58a6ff" />
                                            </div>
                                            <div style={{ textAlign: 'center' }}>
                                                <Text size="lg" fw={600} c="white" mb={4}>
                                                    Your Sandbox is Ready
                                                </Text>
                                                <Text size="sm" c="dimmed" maw={320}>
                                                    Python, Java, C/C++, C#, LaTeX が利用できます。<br />
                                                    あなた専用の隔離された Linux 環境です。
                                                </Text>
                                            </div>

                                            {sessionState === 'error' && errorMsg && (
                                                <Alert
                                                    icon={<IconAlertCircle size={16} />}
                                                    color="red"
                                                    title="接続エラー"
                                                    maw={380}
                                                >
                                                    {errorMsg}
                                                </Alert>
                                            )}

                                            <Button
                                                size="lg"
                                                color="blue"
                                                leftSection={<IconPlayerPlay size={20} />}
                                                onClick={handleLaunch}
                                                style={{
                                                    background: 'linear-gradient(135deg, #1f6feb, #388bfd)',
                                                    boxShadow: '0 0 24px rgba(88,166,255,0.4)',
                                                    padding: '0 36px',
                                                }}
                                            >
                                                {sessionState === 'error' ? 'Retry Connection' : 'Launch Terminal'}
                                            </Button>
                                        </Stack>
                                    )}

                                    {/* 起動中スピナー */}
                                    {sessionState === 'starting' && !xtermRef.current && (
                                        <Stack
                                            align="center"
                                            justify="center"
                                            style={{
                                                position: 'absolute', inset: 0,
                                                background: 'rgba(13,17,23,0.85)',
                                                zIndex: 10,
                                            }}
                                        >
                                            <Loader color="blue" size="md" />
                                            <Text size="sm" c="dimmed">Starting container...</Text>
                                        </Stack>
                                    )}
                                </div>
                            </Card>
                        </Grid.Col>
                    </Grid>
                </Container>
            </AppShell.Main>
        </AppShell>
    );
}
