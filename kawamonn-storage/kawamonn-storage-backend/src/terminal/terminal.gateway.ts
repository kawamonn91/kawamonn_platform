import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
    WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { SshService } from '../ssh/ssh.service';
import { Logger } from '@nestjs/common';
import * as Docker from 'dockerode';
import { Duplex } from 'stream';

interface TerminalSession {
    exec: Docker.Exec;
    stream: Duplex;
    username: string;
}

const ALLOWED_ORIGINS = [
    'https://storage.kawamonn.com',
    'https://account.kawamonn.com',
    'https://web.kawamonn.com',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:3000',
];

@WebSocketGateway({
    namespace: '/terminal',
    cors: {
        origin: ALLOWED_ORIGINS,
        credentials: true,
    },
})
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(TerminalGateway.name);
    // クライアントIDとセッション情報のマッピング
    private sessions = new Map<string, TerminalSession>();

    constructor(
        private readonly jwtService: JwtService,
        private readonly sshService: SshService,
    ) {}

    // --------------------------------------------------
    // 接続時: JWTを検証してusernameをソケットに付与
    // --------------------------------------------------
    async handleConnection(client: Socket) {
        try {
            const token =
                (client.handshake.auth?.token as string) ||
                (client.handshake.query?.token as string);

            if (!token) {
                this.logger.warn(`[${client.id}] 接続拒否: JWTトークンなし`);
                client.emit('error', { message: 'Unauthorized: no token provided' });
                client.disconnect();
                return;
            }

            const payload = this.jwtService.verify(token);
            client.data.username = payload.account_name as string;
            client.data.role = payload.role as string;

            this.logger.log(`[${client.id}] 接続: ユーザー=${client.data.username}`);
        } catch (err) {
            this.logger.warn(`[${client.id}] JWT検証失敗: ${err.message}`);
            client.emit('error', { message: 'Unauthorized: invalid token' });
            client.disconnect();
        }
    }

    // --------------------------------------------------
    // 切断時: PTYセッションを終了する
    // --------------------------------------------------
    async handleDisconnect(client: Socket) {
        this.logger.log(`[${client.id}] 切断: ユーザー=${client.data.username}`);
        const session = this.sessions.get(client.id);
        if (session) {
            try {
                session.stream.destroy();
            } catch (_) { /* ignore */ }
            this.sessions.delete(client.id);
        }
    }

    // --------------------------------------------------
    // ターミナル起動: コンテナを確保しPTYセッションを開始
    // --------------------------------------------------
    @SubscribeMessage('start')
    async handleStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { cols?: number; rows?: number },
    ) {
        const username = client.data.username as string;
        if (!username) {
            throw new WsException('Unauthorized');
        }

        // すでにセッションが存在する場合は何もしない
        if (this.sessions.has(client.id)) {
            client.emit('output', '\r\n[Terminal already running]\r\n');
            return;
        }

        try {
            client.emit('output', '\r\nStarting your sandbox environment...\r\n');

            // コンテナを確保（未起動なら起動）
            const containerId = await this.sshService.ensureContainerRunning(username);

            const cols = data?.cols || 80;
            const rows = data?.rows || 24;

            // PTY セッション開始
            const { exec, stream } = await this.sshService.createExecSession(
                containerId,
                username,
                cols,
                rows,
            );

            this.sessions.set(client.id, { exec, stream: stream as unknown as Duplex, username });

            // コンテナ出力 → クライアントへストリーミング
            stream.on('data', (chunk: Buffer) => {
                client.emit('output', chunk.toString('binary'));
            });

            stream.on('end', () => {
                client.emit('output', '\r\n[Session ended]\r\n');
                this.sessions.delete(client.id);
                client.emit('session_ended');
            });

            stream.on('error', (err) => {
                this.logger.error(`[${client.id}] stream error: ${err.message}`);
                client.emit('output', '\r\n[Stream error]\r\n');
            });

            this.logger.log(`[${client.id}] PTYセッション開始: container=${containerId}`);
            client.emit('ready');
        } catch (err) {
            this.logger.error(`[${client.id}] セッション開始失敗: ${err.message}`);
            client.emit('output', `\r\n[Error: ${err.message}]\r\n`);
            client.emit('error', { message: err.message });
        }
    }

    // --------------------------------------------------
    // キー入力: ブラウザ → コンテナ stdin
    // --------------------------------------------------
    @SubscribeMessage('input')
    handleInput(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { input: string },
    ) {
        const session = this.sessions.get(client.id);
        if (!session) return;

        try {
            session.stream.write(data.input);
        } catch (err) {
            this.logger.error(`[${client.id}] 入力書き込みエラー: ${err.message}`);
        }
    }

    // --------------------------------------------------
    // ターミナルリサイズ: cols/rows をPTYに反映
    // --------------------------------------------------
    @SubscribeMessage('resize')
    async handleResize(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { cols: number; rows: number },
    ) {
        const session = this.sessions.get(client.id);
        if (!session) return;

        try {
            await session.exec.resize({ w: data.cols, h: data.rows });
        } catch (_) {
            // resize は非クリティカル
        }
    }

    // --------------------------------------------------
    // セッション終了: PTYを明示的に終了
    // --------------------------------------------------
    @SubscribeMessage('disconnect_session')
    handleDisconnectSession(@ConnectedSocket() client: Socket) {
        const session = this.sessions.get(client.id);
        if (session) {
            try {
                session.stream.destroy();
            } catch (_) {}
            this.sessions.delete(client.id);
        }
        client.emit('session_ended');
    }
}
