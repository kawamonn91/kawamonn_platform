import { IsNotEmpty, IsString } from 'class-validator';

export class AdminVerifyDto {
    @IsString()
    @IsNotEmpty()
    account_name: string;

    @IsString()
    @IsNotEmpty()
    otp_code: string;
}
