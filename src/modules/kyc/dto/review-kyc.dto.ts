import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { KycStatus } from '@prisma/client';

export class ReviewKycDto {
  @ApiProperty({
    enum: KycStatus,
    description: 'The new verification status',
  })
  @IsEnum(KycStatus)
  status: KycStatus;

  @ApiProperty({
    required: false,
    example: 'Document is blurry. Please resubmit a clearer scan.',
    description: 'Admin feedback for the instructor',
  })
  @IsOptional()
  @IsString()
  adminNotes?: string;
}
