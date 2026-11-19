import { useCallback, useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useWebTerminal } from '../hooks/useWebTerminal';
import {
    embedParentOrigins,
    parseHostMessage,
    postStateToParent,
    sanitizePaste,
    type EmbedState,
} from '../lib/terminal-embed';

const PARENT_ORIGINS = embedParentOrigins();

// 学習のサイトの小窓に埋め込む端末（/embed/terminal）。端末だけを画面いっぱいに出す。
// ログインはストレージと同じ（このサイトに保存したトークン）。ログインしていなければ、
// 新しいタブでログインしてもらい、ログインが済んだら（storage イベント）自動でつなぐ。
export default function EmbedTerminal() {
    const [hasToken, setHasToken] = useState(() => !!localStorage.getItem('token'));
    const { terminalRef, sessionState, errorMsg, terminalReady, launch, paste, focus } = useWebTerminal({ fontSize: 13 });
    // つながる前に届いた「貼る」は、つながってから貼る
    const pending = useRef<string[]>([]);
    const started = useRef(false);

    const recheckLogin = useCallback(() => setHasToken(!!localStorage.getItem('token')), []);

    useEffect(() => {
        window.addEventListener('storage', recheckLogin);
        window.addEventListener('focus', recheckLogin);
        return () => {
            window.removeEventListener('storage', recheckLogin);
            window.removeEventListener('focus', recheckLogin);
        };
    }, [recheckLogin]);

    // 開いたら（ログインが済んだら）すぐにつなぐ。小窓を開いたこと自体が「端末を使う」という操作なので
    useEffect(() => {
        if (!hasToken || started.current) return;
        started.current = true;
        queueMicrotask(() => launch());
    }, [hasToken, launch]);

    const unauthorized = /^Unauthorized/.test(errorMsg);
    const state: EmbedState = !hasToken || unauthorized ? 'login-required' : sessionState;

    useEffect(() => {
        postStateToParent(state, PARENT_ORIGINS);
        if (state === 'connected') {
            for (const text of pending.current.splice(0)) paste(text);
        }
    }, [state, paste]);

    // 埋め込んだ側（学習のサイト）からの指示。許したサイトからのものだけを受け付ける
    useEffect(() => {
        function onMessage(event: MessageEvent) {
            if (!PARENT_ORIGINS.includes(event.origin)) return;
            const message = parseHostMessage(event.data);
            if (!message) return;
            if (message.type === 'paste') {
                const text = sanitizePaste(message.text);
                if (text && !paste(text)) pending.current.push(text);
            } else if (message.type === 'connect') {
                if (localStorage.getItem('token')) launch();
            } else {
                focus();
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [paste, launch, focus]);

    function openLogin() {
        window.open(`/login?next=${encodeURIComponent('/ssh')}`, '_blank', 'noopener');
    }

    function reconnect() {
        recheckLogin();
        if (localStorage.getItem('token')) launch();
    }

    const showTerminal = sessionState === 'connected' || sessionState === 'starting';

    return (
        <div className="embed-terminal">
            <div
                ref={terminalRef}
                className="embed-terminal-screen"
                style={{ display: showTerminal ? 'block' : 'none' }}
            />

            {sessionState === 'starting' && !terminalReady && (
                <div className="embed-terminal-cover">コンテナを起動しています…</div>
            )}

            {state === 'login-required' && (
                <div className="embed-terminal-cover">
                    <p>端末を使うには、UoA Online ストレージにログインしてください（学習とは別のログインです）。</p>
                    <div className="embed-terminal-actions">
                        <button type="button" className="is-primary" onClick={openLogin}>
                            ストレージにログイン
                        </button>
                        <button type="button" onClick={reconnect}>
                            ログインした
                        </button>
                    </div>
                </div>
            )}

            {state !== 'login-required' && (sessionState === 'idle' || sessionState === 'error') && (
                <div className="embed-terminal-cover">
                    {sessionState === 'error' && errorMsg && <p className="embed-terminal-error">{errorMsg}</p>}
                    <div className="embed-terminal-actions">
                        <button type="button" className="is-primary" onClick={reconnect}>
                            {sessionState === 'error' ? 'もう一度つなぐ' : '端末を開く'}
                        </button>
                        <a href="/ssh" target="_blank" rel="noopener">
                            新しいタブで開く
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}
