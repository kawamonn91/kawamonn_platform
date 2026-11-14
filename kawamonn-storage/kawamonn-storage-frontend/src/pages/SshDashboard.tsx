import { useEffect, useRef, useState, useCallback } from 'react';
import {
    AppShell, Group, Button, Container, Text, Badge,
    Stack, Loader, Alert, Grid, Tooltip, ActionIcon,
} from '@mantine/core';
import {
    IconPlayerPlay, IconPlayerStop, IconRefresh, IconAlertCircle, IconArrowLeft,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import api from '../api/client';
import { useAuth } from '../AuthContext';
import SshFileBrowser from '../components/SshFileBrowser';
import { BrandLockup } from '../components/Brand';

type SessionState = 'idle' | 'starting' | 'connected' | 'disconnecting' | 'error';

interface SshStatus {
    container_status: string;
    resource_usage: { cpu_limit: string; memory_limit: string };
}

export default function SshDashboard() {
    const navigate = useNavigate();
    const { logout, accountName } = useAuth();

    // ターミナル状態
    const [sessionState, setSessionState] = useState<SessionState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [containerStatus, setContainerStatus] = useState<SshStatus | null>(null);
    const [terminalReady, setTerminalReady] = useState(false);

    // refs
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const inputListenerRef = useRef<IDisposable | null>(null);
    const connectedRef = useRef(false);

    const fetchStatus = useCallback(async () => {
        try {
            if (!accountName) return;
            const res = await api.get(`/api/v1/ssh/status/${encodeURIComponent(accountName)}`);
            setContainerStatus(res.data);
        } catch (err) {
            if (!axios.isAxiosError(err) || err.response?.status !== 404) {
                console.error('Failed to fetch SSH status');
            }
        }
    }, [accountName]);

    useEffect(() => {
        (async () => { await fetchStatus(); })();
    }, [fetchStatus]);

    // ----------------------------------------------
    // xterm.js の初期化（DOM mount 後に1回だけ・同期実行）
    // ----------------------------------------------
    const initTerminal = useCallback(() => {
        if (!terminalRef.current || xtermRef.current) return;

        const term = new Terminal({
            // 端末の配色は T-tech の共通トークンのダーク（紙と墨の中間色）に合わせる
            theme: {
                background: '#161412',
                foreground: '#edeae5',
                cursor: '#f0795a',
                cursorAccent: '#161412',
                selectionBackground: '#4a453e',
                black: '#4a453e',
                red: '#f2877c',
                green: '#6bc28e',
                yellow: '#e0b25a',
                blue: '#7aa7d6',
                magenta: '#c79bd1',
                cyan: '#6cc3c0',
                white: '#d6d1c9',
                brightBlack: '#8c867d',
                brightRed: '#f6a59c',
                brightGreen: '#8fd4a9',
                brightYellow: '#ecc77d',
                brightBlue: '#9cc0e6',
                brightMagenta: '#d9b6e0',
                brightCyan: '#90d6d3',
                brightWhite: '#f7f6f3',
            },
            fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, "BIZ UDGothic", monospace',
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

        try {
            fitAddon.fit();
        } catch {
            // まだ非表示の間は fit() が失敗することがあるので、表示された直後の effect でもう一度合わせる
        }

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;
        setTerminalReady(true);

        // ターミナルリサイズ監視
        const ro = new ResizeObserver(() => {
            try {
                fitAddon.fit();
            } catch {
                // fit() can throw if the terminal was detached from the DOM mid-resize; safe to ignore.
            }
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

    // 端末要素が表示状態になった直後にサイズを合わせる
    useEffect(() => {
        if (sessionState === 'starting' || sessionState === 'connected') {
            try {
                fitAddonRef.current?.fit();
            } catch {
                // ignore
            }
        }
    }, [sessionState]);

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
    const endSession = useCallback(() => {
        connectedRef.current = false;
        inputListenerRef.current?.dispose();
        inputListenerRef.current = null;
    }, []);

    const handleLaunch = useCallback(async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login');
            return;
        }

        // Socket 接続を開始する前に同期的に xterm を初期化し、初期出力の取りこぼしを防ぐ
        if (terminalRef.current) {
            terminalRef.current.style.display = 'block';
        }
        initTerminal();

        setSessionState('starting');
        setErrorMsg('');

        // 前の接続(エラーで終わったものなど)が残っていれば閉じてから
        socketRef.current?.disconnect();
        endSession();

        // Socket.io 接続
        const socket = io('/terminal', {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: false,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            try {
                fitAddonRef.current?.fit();
            } catch {
                // ignore
            }
            const cols = xtermRef.current?.cols || 80;
            const rows = xtermRef.current?.rows || 24;
            socket.emit('start', { cols, rows });
        });

        socket.on('ready', () => {
            setSessionState('connected');
            connectedRef.current = true;
            void fetchStatus();

            try {
                fitAddonRef.current?.fit();
            } catch {
                // fit() can throw if the terminal was detached from the DOM; safe to ignore.
            }
            if (xtermRef.current) {
                socket.emit('resize', { cols: xtermRef.current.cols, rows: xtermRef.current.rows });
            }

            inputListenerRef.current?.dispose();
            inputListenerRef.current = xtermRef.current?.onData((data) => {
                socket.emit('input', { input: data });
            }) ?? null;
        });

        socket.on('output', (data: string) => {
            xtermRef.current?.write(data);
        });

        socket.on('session_ended', () => {
            endSession();
            setSessionState('idle');
            xtermRef.current?.writeln('\r\n\x1b[33m[セッションが終わりました。「端末を開く」でつなぎ直せます]\x1b[0m');
        });

        socket.on('error', (err: { message: string }) => {
            setErrorMsg(err.message || '接続できませんでした');
            setSessionState('error');
        });

        socket.on('exception', (err: { message?: string }) => {
            setErrorMsg(err?.message || '端末でエラーが起きました');
            setSessionState('error');
            socket.disconnect();
        });

        socket.on('connect_error', (err) => {
            setErrorMsg(`接続できませんでした（${err.message}）`);
            setSessionState('error');
        });

        socket.on('disconnect', (reason) => {
            if (connectedRef.current) {
                xtermRef.current?.writeln(`\r\n\x1b[31m[切断しました: ${reason}]\x1b[0m`);
            }
            endSession();
            setSessionState('idle');
        });
    }, [navigate, fetchStatus, endSession, initTerminal]);

    // ----------------------------------------------
    // セッション切断
    // ----------------------------------------------
    const handleDisconnect = useCallback(() => {
        setSessionState('disconnecting');
        endSession();
        if (socketRef.current) {
            socketRef.current.emit('disconnect_session');
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        setSessionState('idle');
    }, [endSession]);

    const statusColor: Record<SessionState, string> = {
        idle: 'gray',
        starting: 'yellow',
        connected: 'green',
        disconnecting: 'orange',
        error: 'red',
    };

    const statusLabel: Record<SessionState, string> = {
        idle: '未接続',
        starting: '起動しています…',
        connected: '接続中',
        disconnecting: '切断しています…',
        error: 'エラー',
    };

    const containerLabels: Record<string, string> = {
        running: '動いています',
        exited: '止まっています',
        created: '作成済み',
        paused: '一時停止中',
    };
    const containerRunning = containerStatus?.container_status === 'running';
    const containerLabel = containerStatus
        ? containerLabels[containerStatus.container_status] ?? containerStatus.container_status
        : 'まだありません';
    const canLaunch = sessionState === 'idle' || sessionState === 'error';

    return (
        <AppShell header={{ height: 56 }} padding="md">
            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between" wrap="nowrap">
                    <Group gap="md" wrap="nowrap">
                        <BrandLockup section="SSH 端末" to="/" />
                        <Badge color={statusColor[sessionState]} variant="dot" size="sm" visibleFrom="xs">
                            {statusLabel[sessionState]}
                        </Badge>
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                        <Tooltip label="状態を更新">
                            <ActionIcon
                                variant="subtle"
                                color="gray"
                                onClick={() => void fetchStatus()}
                                disabled={sessionState === 'starting'}
                                aria-label="状態を更新"
                            >
                                <IconRefresh size={16} />
                            </ActionIcon>
                        </Tooltip>
                        <Button
                            variant="subtle"
                            color="gray"
                            size="xs"
                            leftSection={<IconArrowLeft size={14} />}
                            onClick={() => navigate('/')}
                        >
                            ストレージ
                        </Button>
                        <Button variant="default" size="xs" onClick={() => { logout(); navigate('/login'); }}>
                            ログアウト
                        </Button>
                    </Group>
                </Group>
            </AppShell.Header>

            <AppShell.Main>
                <Container size="xl" pt="xs">
                    <Grid>
                        {/* 左: 環境の状態・ファイル・入っているもの */}
                        <Grid.Col span={{ base: 12, md: 3 }}>
                            <Stack gap="sm">
                                <div className="ssh-panel" style={{ padding: 16 }}>
                                    <p className="ssh-label">環境</p>
                                    <Stack gap={6}>
                                        <Group justify="space-between">
                                            <Text size="sm" c="dimmed">コンテナ</Text>
                                            <Badge color={containerRunning ? 'green' : 'gray'} size="sm" variant="light">
                                                {containerLabel}
                                            </Badge>
                                        </Group>
                                        {containerStatus && (
                                            <>
                                                <Group justify="space-between">
                                                    <Text size="sm" c="dimmed">CPU の上限</Text>
                                                    <Text size="sm">
                                                        {Number(containerStatus.resource_usage.cpu_limit) * 100}%
                                                    </Text>
                                                </Group>
                                                <Group justify="space-between">
                                                    <Text size="sm" c="dimmed">メモリの上限</Text>
                                                    <Text size="sm">{containerStatus.resource_usage.memory_limit}</Text>
                                                </Group>
                                            </>
                                        )}
                                    </Stack>
                                </div>

                                {canLaunch ? (
                                    <Button
                                        fullWidth
                                        leftSection={<IconPlayerPlay size={16} />}
                                        onClick={() => void handleLaunch()}
                                    >
                                        端末を開く
                                    </Button>
                                ) : sessionState === 'starting' ? (
                                    <Button fullWidth variant="light" loading>
                                        起動しています
                                    </Button>
                                ) : (
                                    <Button
                                        fullWidth
                                        variant="default"
                                        leftSection={<IconPlayerStop size={16} />}
                                        onClick={handleDisconnect}
                                    >
                                        切断する
                                    </Button>
                                )}

                                <div
                                    className="ssh-panel"
                                    style={{ overflow: 'hidden', height: 520, display: 'flex', flexDirection: 'column' }}
                                >
                                    <div className="ssh-panel-head">ファイル</div>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <SshFileBrowser />
                                    </div>
                                </div>

                                <div className="ssh-panel" style={{ padding: 16 }}>
                                    <p className="ssh-label">入っている言語とツール</p>
                                    <ul className="ssh-tools">
                                        {['Python 3', 'Java 21', 'C / C++', 'C# (.NET 8)', 'LaTeX', 'Git'].map((label) => (
                                            <li key={label}>{label}</li>
                                        ))}
                                    </ul>
                                </div>
                            </Stack>
                        </Grid.Col>

                        {/* 右: 端末 */}
                        <Grid.Col span={{ base: 12, md: 9 }}>
                            <div className="ssh-terminal">
                                <div className="ssh-terminal-head">
                                    <span>{accountName} の端末</span>
                                    <span className={`ssh-terminal-state${sessionState === 'connected' ? ' is-on' : ''}`}>
                                        {statusLabel[sessionState]}
                                    </span>
                                </div>

                                <div style={{ position: 'relative', minHeight: 480 }}>
                                    <div
                                        ref={terminalRef}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            minHeight: 480,
                                            padding: '8px 4px',
                                            display:
                                                sessionState === 'connected' || sessionState === 'starting'
                                                    ? 'block'
                                                    : 'none',
                                        }}
                                    />

                                    {canLaunch && (
                                        <div className="ssh-terminal-empty">
                                            <h2>自分専用の Linux 環境</h2>
                                            <p>
                                                Python・Java・C/C++・C#・LaTeX が使えます。ほかの人とは分けられた環境です。
                                                左の「ファイル」からも、中のファイルを開いて編集できます。
                                            </p>

                                            {sessionState === 'error' && errorMsg && (
                                                <Alert
                                                    icon={<IconAlertCircle size={16} />}
                                                    color="red"
                                                    title="接続エラー"
                                                    maw={380}
                                                    ta="left"
                                                >
                                                    {errorMsg}
                                                </Alert>
                                            )}

                                            <Button
                                                size="md"
                                                leftSection={<IconPlayerPlay size={18} />}
                                                onClick={() => void handleLaunch()}
                                            >
                                                {sessionState === 'error' ? 'もう一度つなぐ' : '端末を開く'}
                                            </Button>
                                        </div>
                                    )}

                                    {sessionState === 'starting' && !terminalReady && (
                                        <div className="ssh-terminal-cover">
                                            <Loader size="sm" />
                                            <span>コンテナを起動しています…</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Grid.Col>
                    </Grid>
                </Container>
            </AppShell.Main>
        </AppShell>
    );
}
