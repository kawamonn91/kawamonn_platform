import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ACCOUNT_NAME_PATTERN,
  ACCOUNT_NAME_RULE_MESSAGE,
} from '../../common/account-name';

export class CreateUserDto {
  @IsEmail()
  email: string;

  /** 省くとメールアドレスの @ の前を使う(その場合も AdminService で検査する) */
  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_NAME_PATTERN, { message: ACCOUNT_NAME_RULE_MESSAGE })
  account_name?: string;

  /** 省くと仮パスワードを作って返す */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: string;

  /** 容量の上限(GiB)。省くと DB の既定(20GiB) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  quota_gb?: number;
}
