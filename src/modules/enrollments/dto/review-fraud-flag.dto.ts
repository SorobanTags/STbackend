import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReviewDecision {
  CLEARED = 'CLEARED',
  CONFIRMED = 'CONFIRMED',
}

export class ReviewFraudFlagDto {
  @ApiProperty({ enum: ReviewDecision, description: 'Admin resolution decision' })
  @IsEnum(ReviewDecision, { message: 'decision must be CLEARED or CONFIRMED' })
  decision: ReviewDecision;

  @ApiPropertyOptional({ description: 'Optional free-text note recorded against the flag' })
  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
