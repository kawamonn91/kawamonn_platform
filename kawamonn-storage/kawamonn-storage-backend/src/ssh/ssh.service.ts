import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Docker from 'dockerode';
import * as fs from 'fs';
import { isValidAccountName } from '../common/account-name';
import { userHomePath } from '../common/user-home';

/**
 * 端末のコンテナ専用のネットワーク。ホストのファイアウォール(/etc/host-firewall.nft の inet host_fw)が、
 * このブリッジ(kw-sandbox)から Pi 本体・家の LAN・内部向けの宛先への通信を止め、インターネットにだけ出られるようにしている。
 * コンテナ同士の通信(enable_icc)も止める。名前解決は、閉じる側の網にあるホストの DNS ではなく公開の DNS を使う。
 */
export const SANDBOX_NETWORK = 'kawamonn-sandbox';
export const SANDBOX_BRIDGE = 'kw-sandbox';
const SANDBOX_SUBNET = '172.30.0.0/24';
const SANDBOX_DNS = ['1.1.1.1', '1.0.0.1'];

@Injectable()
export class SshService {
  private docker: Docker;

  constructor(private prisma: PrismaService) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async provisionContainer(username: string, publicKey: string = '') {
    // 利用者名はそのままマウントするフォルダのパスになるので、"." や ".." などは通さない
    if (!isValidAccountName(username)) {
      throw new InternalServerErrorException('Invalid account name');
    }
    const containerName = `kawamonn-ssh-${username}-${Math.random().toString(36).slice(-6)}`;
    const memoryLimit = 512 * 1024 * 1024; // 512MB

    const user = await this.prisma.user.findUnique({
      where: { account_name: username },
      select: { role: true },
    });
    const hostMountPath = userHomePath(username, user?.role === 'admin');

    if (!fs.existsSync(hostMountPath)) {
      fs.mkdirSync(hostMountPath, { recursive: true });
    }

    try {
      await this.ensureSandboxNetwork();
      const container = await this.docker.createContainer({
        Image: 'kawamonn-ssh-base:latest',
        name: containerName,
        HostConfig: {
          Memory: memoryLimit,
          MemorySwap: memoryLimit,
          CpuQuota: 50000, // 50% CPU
          CpuPeriod: 100000,
          Binds: [`${hostMountPath}:/home/${username}:rw`],
          NetworkMode: SANDBOX_NETWORK,
          Dns: SANDBOX_DNS,
          // ブラウザの端末は docker exec で接続するので、コンテナのポートはどこにも公開しない
          // (2026-10 に SSH 接続の入口を廃止した。以前は 22 番を 127.0.0.1 に公開していた)
          RestartPolicy: { Name: 'unless-stopped' },
        },
        Env: [
          `USERNAME=${username}`,
          `PUBLIC_KEY=${publicKey}`,
          // コンテナの起動時に、この UID(backend)へホームの読み書きを許可する ACL を付ける(entrypoint.sh)
          `BACKEND_UID=${process.getuid?.() ?? 1000}`,
        ],
      });

      await container.start();

      return await this.prisma.sshContainer.create({
        data: {
          username,
          container_id: containerName,
          image_tag: 'kawamonn-ssh-base:latest',
          cpu_limit: '0.5',
          memory_limit: '512m',
          last_started_at: new Date(),
        },
      });
    } catch (error) {
      console.error('Docker provisioning failed:', error);
      throw new InternalServerErrorException(
        'Failed to provision SSH container. Ensure Docker daemon is running and image is built.',
      );
    }
  }

  async getStatus(username: string) {
    const dbContainer = await this.prisma.sshContainer.findFirst({
      where: { username },
      orderBy: { created_at: 'desc' },
    });

    if (!dbContainer) {
      throw new NotFoundException(
        'No SSH container provisioned for this user.',
      );
    }

    try {
      const container = this.docker.getContainer(dbContainer.container_id);
      const data = await container.inspect();

      return {
        container_status: data.State.Status,
        resource_usage: {
          cpu_limit: dbContainer.cpu_limit,
          memory_limit: dbContainer.memory_limit,
        },
      };
    } catch {
      return {
        container_status: 'stopped or removed',
        resource_usage: {
          cpu_limit: dbContainer.cpu_limit,
          memory_limit: dbContainer.memory_limit,
        },
      };
    }
  }

  /** 端末のコンテナ専用のネットワークが無ければ作る(同時に作ろうとして重なったときは、そのまま使う) */
  private async ensureSandboxNetwork(): Promise<void> {
    try {
      await this.docker.getNetwork(SANDBOX_NETWORK).inspect();
      return;
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    }
    try {
      await this.docker.createNetwork({
        Name: SANDBOX_NETWORK,
        Driver: 'bridge',
        EnableIPv6: false,
        IPAM: { Config: [{ Subnet: SANDBOX_SUBNET }] },
        Options: {
          'com.docker.network.bridge.name': SANDBOX_BRIDGE,
          'com.docker.network.bridge.enable_icc': 'false',
        },
      });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 409) throw e;
    }
  }

  /**
   * コンテナが存在しなければプロビジョニング、停止中なら起動する。
   * 起動済みのコンテナIDを返す。
   */
  async ensureContainerRunning(username: string): Promise<string> {
    const dbContainer = await this.prisma.sshContainer.findFirst({
      where: { username },
      orderBy: { created_at: 'desc' },
    });

    if (!dbContainer || !dbContainer.container_id) {
      // コンテナが未プロビジョニング → 新規作成
      const newContainer = await this.provisionContainer(username);
      return newContainer.container_id;
    }

    const container = this.docker.getContainer(dbContainer.container_id);
    try {
      const data = await container.inspect();
      // 専用のネットワークに入っていない(以前に作った)コンテナは、作り直す。ホームのファイルはそのまま残る
      if (
        !Object.keys(data.NetworkSettings?.Networks ?? {}).includes(
          SANDBOX_NETWORK,
        )
      ) {
        await container.remove({ force: true });
        const newContainer = await this.provisionContainer(username);
        return newContainer.container_id;
      }
      if (data.State.Status !== 'running') {
        await container.start();
        await this.prisma.sshContainer.update({
          where: { id: dbContainer.id },
          data: { last_started_at: new Date() },
        });
      }
    } catch {
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
    rows: number = 24,
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

    const stream = (await exec.start({
      hijack: true,
      stdin: true,
      Tty: true,
    })) as NodeJS.ReadWriteStream;

    // 初期ターミナルサイズを設定
    try {
      await exec.resize({ w: cols, h: rows });
    } catch {
      /* resize は非クリティカル */
    }

    return { exec, stream };
  }
}
