import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class MkdirDto {
  @IsString()
  @IsNotEmpty()
  path: string;
}

export class WriteTextDto {
  @IsString()
  @IsNotEmpty()
  path: string;

  @IsOptional()
  @IsString()
  content?: string;
}

export class RenameDto {
  @IsString()
  @IsNotEmpty()
  oldPath: string;

  @IsString()
  @IsNotEmpty()
  newPath: string;
}
