import { useEffect, useCallback, useState } from 'react';
import {
    AppShell, Group, Button, Container, Text, Badge,
    Stack, Loader, Alert, Grid, Tooltip, ActionIcon,
} from '@mantine/core';
import {
    IconPlayerPlay, IconPlayerStop, IconRefresh, IconAlertCircle, IconArrowLeft,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '@xterm/xterm/css/xterm.css';
import api from '../api/client';
import { useAuth } from '../AuthContext';
import SshFileBrowser from '../components/SshFileBrowser';
import { BrandLockup } from '../components/Brand';
import { useWebTerminal, type SessionState } from '../hooks/useWebTerminal';

interface SshStatus {
    container_status: string;
    resource_usage: { cpu_limit: string; memory_limit: string };
}

export default function SshDashboard() {
    const navigate = useNavigate();
    const { logout, accountName } = useAuth();

    const [containerStatus, setContainerStatus] = useState<SshStatus | null>(null);

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

    // 端末（xterm.js と WebSocket）。つながったら、コンテナの状態を読み直す
    const onReady = useCallback(() => {
        void fetchStatus();
    }, [fetchStatus]);
    const { terminalRef, sessionState, errorMsg, terminalReady, launch, disconnect } = useWebTerminal({ onReady });

    const handleLaunch = useCallback(() => {
        if (!launch()) navigate('/login');
    }, [launch, navigate]);
    const handleDisconnect = disconnect;

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
                        <BrandLockup section="SSH 端末" />
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
                            ファイルへ戻る
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
