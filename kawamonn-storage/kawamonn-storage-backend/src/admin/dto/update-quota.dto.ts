import { IsInt, Min } from 'class-validator';

export class UpdateQuotaDto {
    @IsInt()
    @Min(1)
    quota_gb: number;
}
