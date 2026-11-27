import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { SmsService } from './sms.service';
import { SendSmsDto } from './dto/send-sms.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { SmsCallbackSignatureGuard } from '../../common/guards/sms-callback-signature.guard';
import { UserRole, SmsTemplateKey } from '@prisma/client';

@ApiTags('sms')
@Controller('notifications/sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send an SMS message for a critical account or enrollment alert' })
  @ApiBody({ type: SendSmsDto })
  sendSms(@Body() dto: SendSmsDto) {
    return this.smsService.sendSms({
      phoneNumber: dto.phoneNumber,
      countryCode: dto.countryCode,
      userId: dto.userId,
      templateKey: dto.templateKey,
      templateData: dto.templateData,
      message: dto.message,
    });
  }

  @Get(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the delivery status of an SMS message' })
  getStatus(@Param('id') id: string) {
    return this.smsService.getDeliveryStatus(id);
  }

  @Post('callback')
  @UseGuards(SmsCallbackSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delivery status callback invoked by the SMS gateway (signature-verified)' })
  handleCallback(@Body() payload: { id: string; status: string; phoneNumber?: string }) {
    return this.smsService.handleDeliveryCallback(payload);
  }
}
