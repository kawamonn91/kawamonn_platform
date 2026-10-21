import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from '../common/jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: { sub: string; role?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    // 削除済み、または期限切れで削除(status=deleted)になったユーザーのトークンは、
    // 有効期限内でも受け付けない(ブラウザ端末の terminal.gateway.ts と同じ扱い)
    if (!user || user.status === 'deleted') {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      account_name: user.account_name,
      email: user.email,
      role: effectiveRole(payload.role, user.role),
    };
  }
}

/**
 * このトークンで使える役割。管理者として扱うのは、確認コード(OTP)を通して発行したトークン
 * (/auth/admin/verify。トークンに role: 'admin' と書く)で、DB でも今も管理者のときだけ。
 * 通常のログイン(/auth/login、パスワードだけ)のトークンは、管理者のアカウントでも一般の利用者として扱う。
 * (以前は DB の役割をそのまま返していたため、管理者はパスワードだけで管理者の API を使えた)
 */
export function effectiveRole(
  tokenRole: string | undefined,
  dbRole: string,
): 'admin' | 'user' {
  return tokenRole === 'admin' && dbRole === 'admin' ? 'admin' : 'user';
}
