import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateMeDto {
    @IsOptional()
    @IsString()
    current_password?: string;

    // Deliberately no character-set restriction on the password itself.
    @IsOptional()
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    new_password?: string;
}
