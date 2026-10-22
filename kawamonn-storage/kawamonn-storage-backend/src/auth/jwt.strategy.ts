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

  async validate(payload: { sub: string; role?: string; iat?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        account_name: true,
        email: true,
        role: true,
        status: true,
        password_last_set_at: true,
      },
    });

    // 削除済み、または期限切れで削除(status=deleted)になったユーザーのトークン、
    // およびパスワード変更・再設定より前に発行されたトークンは受け付けない
    // (ブラウザ端末の terminal.gateway.ts と同じ扱い)
    if (
      !user ||
      user.status === 'deleted' ||
      (typeof payload.iat === 'number' &&
        user.password_last_set_at &&
        payload.iat < Math.floor(user.password_last_set_at.getTime() / 1000))
    ) {
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
