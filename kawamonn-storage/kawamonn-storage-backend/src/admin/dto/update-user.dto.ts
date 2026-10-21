import { IsEmail } from 'class-validator';

/** 利用者の情報の変更(今はメールアドレスだけ。容量は POST /admin/users/:id/quota で変える) */
export class UpdateUserDto {
  @IsEmail()
  email: string;
}
