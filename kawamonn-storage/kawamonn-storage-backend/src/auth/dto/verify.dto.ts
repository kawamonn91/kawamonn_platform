import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class VerifyDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsNotEmpty()
    code: string;
}
