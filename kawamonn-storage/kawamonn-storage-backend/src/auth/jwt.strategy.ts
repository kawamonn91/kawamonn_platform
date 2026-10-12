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

  async validate(payload: any) {
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
      role: user.role,
    };
  }
}
