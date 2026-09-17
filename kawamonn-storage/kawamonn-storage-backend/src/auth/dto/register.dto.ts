import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';

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
    @Matches(/^[a-zA-Z0-9_.-]+$/, {
        message: 'Username can only contain letters, numbers, and _ . -'
    })
    display_name: string;

    @IsOptional()
    @IsString()
    otp_code?: string;
}
