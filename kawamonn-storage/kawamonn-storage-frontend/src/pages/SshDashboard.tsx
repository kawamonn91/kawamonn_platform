import { useEffect, useRef, useState, useCallback } from 'react';
import {
    AppShell, Group, Title, Button, Container, Text, Badge,
    Card, Stack, Loader, Alert, Grid, Progress, Tooltip, ActionIcon,
} from '@mantine/core';
import {
    IconTerminal2, IconPlayerPlay, IconPlayerStop, IconRefresh,
    IconAlertCircle, IconArrowLeft, IconCpu, IconDeviceFloppy,
    IconPlugConnected, IconPlugConnectedX, IconFolder,
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
            xtermRef.current?.writeln('\r\n\x1b[33m[Session ended. Press "Launch Terminal" to reconnect.]\x1b[0m');
        });

        socket.on('error', (err: { message: string }) => {
            setErrorMsg(err.message || 'Connection error');
            setSessionState('error');
        });

        socket.on('exception', (err: { message?: string }) => {
            setErrorMsg(err?.message || 'Terminal error');
            setSessionState('error');
            socket.disconnect();
        });

        socket.on('connect_error', (err) => {
            setErrorMsg(`Connection failed: ${err.message}`);
            setSessionState('error');
        });

        socket.on('disconnect', (reason) => {
            if (connectedRef.current) {
                xtermRef.current?.writeln(`\r\n\x1b[31m[Disconnected: ${reason}]\x1b[0m`);
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
                                onClick={() => void fetchStatus()}
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

                                {sessionState === 'idle' || sessionState === 'error' ? (
                                    <Button
                                        fullWidth
                                        size="md"
                                        color="blue"
                                        variant="filled"
                                        leftSection={<IconPlayerPlay size={18} />}
                                        onClick={() => void handleLaunch()}
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
                                    </Group>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <SshFileBrowser />
                                    </div>
                                </Card>

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
                                            <div
                                                style={{
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: '50%',
                                                    background: color,
                                                    flexShrink: 0,
                                                }}
                                            />
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
                                    boxShadow:
                                        sessionState === 'connected'
                                            ? '0 0 30px rgba(35, 134, 54, 0.15)'
                                            : 'none',
                                }}
                            >
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
                                            {accountName}@kawamonn-sandbox
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

                                    {(sessionState === 'idle' || sessionState === 'error') && (
                                        <Stack
                                            align="center"
                                            justify="center"
                                            style={{ minHeight: 480, padding: 32 }}
                                            gap="lg"
                                        >
                                            <div
                                                style={{
                                                    width: 80,
                                                    height: 80,
                                                    borderRadius: '50%',
                                                    background: 'rgba(88,166,255,0.08)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    border: '1px solid rgba(88,166,255,0.2)',
                                                }}
                                            >
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
                                                onClick={() => void handleLaunch()}
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

                                    {sessionState === 'starting' && !terminalReady && (
                                        <Stack
                                            align="center"
                                            justify="center"
                                            style={{
                                                position: 'absolute',
                                                inset: 0,
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
