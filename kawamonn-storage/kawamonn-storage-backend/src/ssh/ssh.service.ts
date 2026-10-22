import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Docker from 'dockerode';
import * as crypto from 'crypto';
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

const IMAGE = 'kawamonn-ssh-base:latest';
const CPU_LIMIT = 0.5; // CPU 1個の半分
const MEMORY_LIMIT_MB = 512;
const PIDS_LIMIT = 256;
// 日本語のファイル名や出力を扱えるようにする(イメージには locale の設定が無い。C.UTF-8 は追加の部品なしで使える)
const LANG_ENV = 'LANG=C.UTF-8';

/** Docker の API の失敗のうち、相手(コンテナ・ネットワーク)が無かったもの */
function isNotFound(e: unknown): boolean {
  return (e as { statusCode?: number })?.statusCode === 404;
}

@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });
  /** 利用者ごとの、用意している途中のコンテナ(同じ人が2つの画面で同時に端末を開いても、1つだけ作る) */
  private readonly preparing = new Map<string, Promise<string>>();

  constructor(private prisma: PrismaService) {}

  /**
   * 利用者の端末のコンテナを新しく作って起動し、名前を返す。以前のコンテナと記録は消す。
   * 端末は docker exec で使うので、コンテナの中で常駐させるものは要らない。イメージの既定のコマンド(sshd)は
   * 使わずに待機だけさせる(2026-10 に SSH 接続の入口を廃止した)。Init で PID 1 を tini にし、止めるときにすぐ終わるようにする
   */
  async provisionContainer(username: string): Promise<string> {
    // 利用者名はそのままマウントするフォルダのパスになるので、"." や ".." などは通さない
    if (!isValidAccountName(username)) {
      throw new InternalServerErrorException('Invalid account name');
    }
    const user = await this.prisma.user.findUnique({
      where: { account_name: username },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('Account not found');
    const hostMountPath = userHomePath(username, user.role === 'admin');
    if (!fs.existsSync(hostMountPath)) {
      fs.mkdirSync(hostMountPath, { recursive: true });
    }

    await this.removeUserContainers(username);
    const containerName = `kawamonn-ssh-${username}-${crypto.randomBytes(3).toString('hex')}`;
    try {
      await this.ensureSandboxNetwork();
      const container = await this.docker.createContainer({
        Image: IMAGE,
        name: containerName,
        Cmd: ['sleep', 'infinity'],
        HostConfig: {
          Init: true,
          Memory: MEMORY_LIMIT_MB * 1024 * 1024,
          MemorySwap: MEMORY_LIMIT_MB * 1024 * 1024,
          CpuQuota: CPU_LIMIT * 100000,
          CpuPeriod: 100000,
          PidsLimit: PIDS_LIMIT,
          Binds: [`${hostMountPath}:/home/${username}:rw`],
          NetworkMode: SANDBOX_NETWORK,
          Dns: SANDBOX_DNS,
          // ブラウザの端末は docker exec で接続するので、コンテナのポートはどこにも公開しない
          RestartPolicy: { Name: 'unless-stopped' },
        },
        Env: [
          `USERNAME=${username}`,
          // コンテナの起動時に、この UID(backend)へホームの読み書きを許可する ACL を付ける(entrypoint.sh)
          `BACKEND_UID=${process.getuid?.() ?? 1000}`,
          LANG_ENV,
        ],
      });
      await container.start();

      await this.prisma.sshContainer.create({
        data: {
          username,
          container_id: containerName,
          image_tag: IMAGE,
          cpu_limit: String(CPU_LIMIT),
          memory_limit: `${MEMORY_LIMIT_MB}m`,
          last_started_at: new Date(),
        },
      });
      return containerName;
    } catch (error) {
      this.logger.error(`Docker provisioning failed for ${username}`, error);
      throw new InternalServerErrorException(
        'Failed to start the terminal environment. Ensure Docker is running and the image is built.',
      );
    }
  }

  /**
   * 利用者の端末のコンテナをすべて消し、その記録(SshContainer の行)も消す。ホームのファイルは消さない。
   * 消せなかったコンテナの記録は残す(次に消すときにもう一度試す)
   */
  async removeUserContainers(username: string): Promise<void> {
    const rows = await this.prisma.sshContainer.findMany({
      where: { username },
    });
    const removed: string[] = [];
    for (const row of rows) {
      if (row.container_id) {
        try {
          await this.docker
            .getContainer(row.container_id)
            .remove({ force: true });
        } catch (e) {
          if (!isNotFound(e)) {
            this.logger.warn(
              `Failed to remove container ${row.container_id} for ${username}: ${(e as Error).message}`,
            );
            continue;
          }
        }
      }
      removed.push(row.id);
    }
    if (removed.length) {
      await this.prisma.sshContainer.deleteMany({
        where: { id: { in: removed } },
      });
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

    let status = 'stopped or removed';
    try {
      const data = await this.docker
        .getContainer(dbContainer.container_id ?? '')
        .inspect();
      status = data.State.Status;
    } catch {
      // コンテナが消えていれば、上の既定のまま
    }
    return {
      container_status: status,
      resource_usage: {
        cpu_limit: dbContainer.cpu_limit,
        memory_limit: dbContainer.memory_limit,
      },
    };
  }

  /** 端末のコンテナ専用のネットワークが無ければ作る(同時に作ろうとして重なったときは、そのまま使う) */
  private async ensureSandboxNetwork(): Promise<void> {
    try {
      await this.docker.getNetwork(SANDBOX_NETWORK).inspect();
      return;
    } catch (e) {
      if (!isNotFound(e)) throw e;
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
   * 利用者の端末のコンテナを起動した状態にして、名前を返す。無ければ作り、止まっていれば起動する。
   * 同じ利用者について同時に呼ばれたときは、先に始めた用意の結果を一緒に使う
   */
  ensureContainerRunning(username: string): Promise<string> {
    const pending = this.preparing.get(username);
    if (pending) return pending;
    const job = this.prepareContainer(username).finally(() =>
      this.preparing.delete(username),
    );
    this.preparing.set(username, job);
    return job;
  }

  private async prepareContainer(username: string): Promise<string> {
    const dbContainer = await this.prisma.sshContainer.findFirst({
      where: { username },
      orderBy: { created_at: 'desc' },
    });
    const container = dbContainer?.container_id
      ? this.docker.getContainer(dbContainer.container_id)
      : null;
    let data: Docker.ContainerInspectInfo | null = null;
    try {
      data = container ? await container.inspect() : null;
    } catch {
      // コンテナが Docker から消えている → 下で作り直す
    }

    // 無い・Docker から消えている・専用のネットワークに入っていない(以前に作った)なら、作り直す。
    // ホームのファイルはそのまま残る
    if (
      !dbContainer?.container_id ||
      !container ||
      !data ||
      !Object.keys(data.NetworkSettings?.Networks ?? {}).includes(
        SANDBOX_NETWORK,
      )
    ) {
      const name = await this.provisionContainer(username);
      await this.waitForUser(name, username);
      return name;
    }
    if (data.State.Status !== 'running') {
      await container.start();
      await this.prisma.sshContainer.update({
        where: { id: dbContainer.id },
        data: { last_started_at: new Date() },
      });
      await this.waitForUser(dbContainer.container_id, username);
    }
    return dbContainer.container_id;
  }

  /**
   * コンテナの起動時の処理(entrypoint.sh がコンテナの中に利用者を作る)が終わるまで待つ。
   * 作ったばかりのコンテナで待たずにシェルを開くと「unable to find user」で失敗し、1回目の端末がすぐに終わっていた
   */
  protected async waitForUser(
    containerId: string,
    username: string,
    timeoutMs = 60000,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const exec = await container.exec({
          Cmd: ['id', '-u', username],
          AttachStdout: true,
          AttachStderr: true,
        });
        const stream = await exec.start({ hijack: true, stdin: false });
        await new Promise<void>((resolve) => {
          stream.on('end', () => resolve());
          stream.on('close', () => resolve());
          stream.on('error', () => resolve());
          stream.resume();
        });
        if ((await exec.inspect()).ExitCode === 0) return;
      } catch {
        // まだ起動の途中
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('The terminal environment did not become ready in time.');
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
      Env: [LANG_ENV],
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
