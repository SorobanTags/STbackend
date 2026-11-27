import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { SmsTemplateKey } from '../sms.service';

export class SendSmsDto {
  @ApiProperty({ description: 'Recipient phone number', example: '+15551234567' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ description: 'Country code for the recipient', example: 'US' })
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @ApiPropertyOptional({ description: 'Identifier of the user receiving the SMS' })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ description: 'Template to render', enum: SmsTemplateKey })
  @IsEnum(SmsTemplateKey)
  @IsOptional()
  templateKey?: SmsTemplateKey;

  @ApiPropertyOptional({
    description: 'Data used to render the template',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  templateData?: Record<string, string | number>;

  @ApiPropertyOptional({ description: 'Raw message body when no template is used' })
  @IsString()
  @IsOptional()
  message?: string;
}