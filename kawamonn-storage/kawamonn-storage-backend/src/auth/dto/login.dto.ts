import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class LoginDto {
    @IsString()
    @IsNotEmpty()
    account_name: string;

    @IsString()
    @IsNotEmpty()
    password: string;

    @IsOptional()
    @IsString()
    totp_code?: string;
}
