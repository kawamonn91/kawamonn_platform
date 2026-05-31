import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Docker from 'dockerode';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class SshService {
    private docker: Docker;

    constructor(private prisma: PrismaService) {
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }

    async provisionContainer(username: string, publicKey: string = '') {
        const containerName = `kawamonn-ssh-${username}-${Math.random().toString(36).slice(-6)}`;
        const memoryLimit = 512 * 1024 * 1024; // 512MB

        const user = await this.prisma.user.findUnique({
            where: { account_name: username },
            select: { role: true },
        });
        const isMin = user && user.role === 'admin';
        const hostMountPath = isMin 
            ? path.join('/home/pi/hdd/ssh', username)
            : path.join('/home/pi/hdd/ssh/users', username);

        if (!fs.existsSync(hostMountPath)) {
            fs.mkdirSync(hostMountPath, { recursive: true });
        }

        try {
            const container = await this.docker.createContainer({
                Image: 'kawamonn-ssh-base:latest',
                name: containerName,
                HostConfig: {
                    Memory: memoryLimit,
                    MemorySwap: memoryLimit,
                    CpuQuota: 50000, // 50% CPU
                    CpuPeriod: 100000,
                    Binds: [`${hostMountPath}:/home/${username}:rw`],
                    PortBindings: { '22/tcp': [{ HostPort: '0' }] },
                    RestartPolicy: { Name: 'unless-stopped' }
                },
                Env: [
                    `USERNAME=${username}`,
                    `PUBLIC_KEY=${publicKey}`
                ]
            });

            await container.start();

            const inspectData = await container.inspect();
            const hostPort = inspectData.NetworkSettings.Ports['22/tcp'][0].HostPort;

            return await this.prisma.sshContainer.create({
                data: {
                    username,
                    container_id: containerName,
                    image_tag: 'kawamonn-ssh-base:latest',
                    cpu_limit: '0.5',
                    memory_limit: '512m',
                    last_started_at: new Date()
                }
            });
        } catch (error) {

            console.error('Docker provisioning failed:', error);
            throw new InternalServerErrorException('Failed to provision SSH container. Ensure Docker daemon is running and image is built.');
        }
    }

    async getStatus(username: string) {
        const dbContainer = await this.prisma.sshContainer.findFirst({
            where: { username },
            orderBy: { created_at: 'desc' }
        });

        if (!dbContainer) {
            throw new NotFoundException('No SSH container provisioned for this user.');
        }

        try {
            const container = this.docker.getContainer(dbContainer.container_id);
            const data = await container.inspect();

            return {
                container_status: data.State.Status,
                ssh_port: data.NetworkSettings.Ports['22/tcp'] ? data.NetworkSettings.Ports['22/tcp'][0].HostPort : null,
                resource_usage: {
                    cpu_limit: dbContainer.cpu_limit,
                    memory_limit: dbContainer.memory_limit
                }
            };
        } catch (error) {
            return {
                container_status: 'stopped or removed',
                resource_usage: {
                    cpu_limit: dbContainer.cpu_limit,
                    memory_limit: dbContainer.memory_limit
                }
            };
        }
    }

    /**
     * コンテナが存在しなければプロビジョニング、停止中なら起動する。
     * 起動済みのコンテナIDを返す。
     */
    async ensureContainerRunning(username: string): Promise<string> {
        const dbContainer = await this.prisma.sshContainer.findFirst({
            where: { username },
            orderBy: { created_at: 'desc' }
        });

        if (!dbContainer || !dbContainer.container_id) {
            // コンテナが未プロビジョニング → 新規作成
            const newContainer = await this.provisionContainer(username);
            return newContainer.container_id;
        }

        const container = this.docker.getContainer(dbContainer.container_id);
        try {
            const data = await container.inspect();
            if (data.State.Status !== 'running') {
                await container.start();
                await this.prisma.sshContainer.update({
                    where: { id: dbContainer.id },
                    data: { last_started_at: new Date() }
                });
            }
        } catch (err) {
            // コンテナが存在しない (Dockerから削除されている) → 再プロビジョニング
            const newContainer = await this.provisionContainer(username);
            return newContainer.container_id;
        }

        return dbContainer.container_id;
    }

    /**
     * 指定コンテナ内で /bin/bash の PTY セッションを開始し、
     * 入出力用の duplex stream を返す。
     */
    async createExecSession(
        containerId: string,
        username: string,
        cols: number = 80,
        rows: number = 24
    ): Promise<{ exec: Docker.Exec; stream: NodeJS.ReadWriteStream }> {
        const container = this.docker.getContainer(containerId);

        const exec = await container.exec({
            Cmd: ['/bin/bash'],
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Tty: true,
            User: username,
            WorkingDir: `/home/${username}`,
        });

        const stream = await exec.start({ hijack: true, stdin: true, Tty: true }) as NodeJS.ReadWriteStream;

        // 初期ターミナルサイズを設定
        try {
            await exec.resize({ w: cols, h: rows });
        } catch (_) { /* resize は非クリティカル */ }

        return { exec, stream };
    }
}
