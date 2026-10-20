import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * 回数制限で数える単位(接続元)を決める。
 *
 * 本番の通信は Cloudflare Tunnel → Pi の中の画面のサーバー(vite preview、/api を backend へ転送)→ backend の順に届くので、
 * backend から見た接続元は全員 127.0.0.1 になる。そのままだと全員で1つの上限を分け合ってしまうため、
 * Pi の中(ループバック)から届いたものに限り、Cloudflare が付ける本当の接続元(CF-Connecting-IP)で数える。
 * 外から直接届いたものの CF-Connecting-IP は信用しない(偽れるため)。
 */
export function clientIpOf(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const remote = req.socket?.remoteAddress ?? req.ip ?? '';
  if (LOOPBACK.has(remote)) {
    const cf = req.headers?.['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  return remote || 'unknown';
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return clientIpOf(req);
  }
}
