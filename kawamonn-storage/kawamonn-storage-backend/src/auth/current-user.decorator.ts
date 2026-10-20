import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** ログイン中の利用者。JwtStrategy.validate() が DB の値から作る */
export interface AuthUser {
  id: string;
  account_name: string;
  email: string;
  role: string;
}

/**
 * ログイン中の利用者を受け取る(JwtAuthGuard を付けたルートで使う)。
 *   @Get('me') getMe(@CurrentUser() me: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
