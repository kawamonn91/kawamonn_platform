import { IsEmail, IsIn, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class CreateUserDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    account_name?: string;

    @IsOptional()
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    password?: string;

    @IsOptional()
    @IsIn(['user', 'admin'])
    role?: string;

    /** Bytes, as a string (matches UpdateUserDto/quota_bytes elsewhere). Defaults to 20GB. */
    @IsOptional()
    @IsString()
    quota_bytes?: string;
}
