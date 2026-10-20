import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import {
  ACCOUNT_NAME_PATTERN,
  ACCOUNT_NAME_RULE_MESSAGE,
} from '../../common/account-name';

export class RegisterDto {
  @IsEmail()
  email: string;

  // Deliberately no character-set restriction: limiting passwords to
  // alphanumerics + _.- lowers achievable entropy instead of raising it.
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsString()
  @IsNotEmpty()
  @Matches(ACCOUNT_NAME_PATTERN, { message: ACCOUNT_NAME_RULE_MESSAGE })
  display_name: string;

  @IsOptional()
  @IsString()
  otp_code?: string;
}
