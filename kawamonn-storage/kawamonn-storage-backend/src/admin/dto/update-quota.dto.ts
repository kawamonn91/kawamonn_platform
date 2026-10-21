import { IsInt, Max, Min } from 'class-validator';

/** 容量の上限。単位は GiB(1024^3 バイト。DB の既定の 20GiB = 21474836480 と同じ数え方) */
export class UpdateQuotaDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  quota_gb: number;
}
