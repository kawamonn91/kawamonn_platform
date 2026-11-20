import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export type SessionState = 'idle' | 'starting' | 'connected' | 'disconnecting' | 'error';

// 端末の配色は T-tech の共通トークンのダーク（紙と墨の中間色）に合わせる
const TERMINAL_THEME = {
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
};

interface Options {
    fontSize?: number;
    // 端末が使えるようになったとき（コンテナの状態を読み直すなど）
    onReady?: () => void;
}

// ブラウザの SSH 端末（xterm.js と、backend の /terminal への WebSocket）。
// 「SSH 端末」のページと、学習のサイトに埋め込む端末（/embed/terminal）で使う。
export function useWebTerminal({ fontSize = 14, onReady }: Options = {}) {
    const [sessionState, setSessionState] = useState<SessionState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [terminalReady, setTerminalReady] = useState(false);

    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const inputListenerRef = useRef<IDisposable | null>(null);
    const connectedRef = useRef(false);
    const onReadyRef = useRef(onReady);
    useEffect(() => {
        onReadyRef.current = onReady;
    }, [onReady]);

    // xterm.js の初期化（DOM mount 後に1回だけ・同期実行）
    const initTerminal = useCallback(() => {
        if (!terminalRef.current || xtermRef.current) return;

        const term = new Terminal({
            theme: TERMINAL_THEME,
            fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, "BIZ UDGothic", monospace',
            fontSize,
            lineHeight: 1.4,
            cursorStyle: 'block',
            cursorBlink: true,
            convertEol: true,
            scrollback: 5000,
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(terminalRef.current);

        try {
            fitAddon.fit();
        } catch {
            // まだ非表示の間は fit() が失敗することがあるので、表示された直後の effect でもう一度合わせる
        }

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;
        setTerminalReady(true);

        // 大きさが変わったら、端末の行数と列数を合わせて backend にも知らせる
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
    }, [fontSize]);

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

    // アンマウント時クリーンアップ
    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
            socketRef.current?.disconnect();
            xtermRef.current?.dispose();
        };
    }, []);

    const endSession = useCallback(() => {
        connectedRef.current = false;
        inputListenerRef.current?.dispose();
        inputListenerRef.current = null;
    }, []);

    // 端末を開く。ログインしていなければ（トークンが無ければ）false を返して何もしない
    const launch = useCallback((): boolean => {
        const token = localStorage.getItem('token');
        if (!token) return false;

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
            onReadyRef.current?.();

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
            // エラーで切れたときは、エラーの表示を残す
            setSessionState((current) => (current === 'error' ? current : 'idle'));
        });
        return true;
    }, [endSession, initTerminal]);

    const disconnect = useCallback(() => {
        setSessionState('disconnecting');
        endSession();
        if (socketRef.current) {
            socketRef.current.emit('disconnect_session');
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        setSessionState('idle');
    }, [endSession]);

    // 文字を端末に貼る（打ち込んだのと同じ扱い。シェルが対応していれば「貼り付け」として扱われ、Enter までは実行されない）
    const paste = useCallback((text: string): boolean => {
        if (!connectedRef.current || !xtermRef.current) return false;
        xtermRef.current.paste(text);
        xtermRef.current.focus();
        return true;
    }, []);

    const focus = useCallback(() => {
        xtermRef.current?.focus();
    }, []);

    return { terminalRef, sessionState, errorMsg, terminalReady, launch, disconnect, paste, focus };
}
