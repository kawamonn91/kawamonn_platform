import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
    @IsOptional()
    @IsString()
    quota_bytes?: string;

    @IsOptional()
    @IsEmail()
    email?: string;
}
