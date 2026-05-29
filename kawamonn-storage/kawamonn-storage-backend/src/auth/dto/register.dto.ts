import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, Matches } from 'class-validator';

export class RegisterDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    @Matches(/^[a-zA-Z0-9_.-]+$/, {
        message: 'Password can only contain letters, numbers, and _ . -'
    })
    password: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^[a-zA-Z0-9_.-]+$/, {
        message: 'Username can only contain letters, numbers, and _ . -'
    })
    display_name: string;

    @IsOptional()
    @IsString()
    otp_code?: string;
}
