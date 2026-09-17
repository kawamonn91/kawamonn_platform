import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BroadcastDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    subject: string;

    @IsString()
    @IsNotEmpty()
    message: string;
}
