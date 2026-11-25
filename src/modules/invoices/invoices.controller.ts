import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get('enrollment/:enrollmentId')
  @ApiOperation({ summary: 'Get the invoice for an enrollment (owner or admin)' })
  findByEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.invoicesService.findByEnrollment(enrollmentId, user.id, user.role === UserRole.ADMIN);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a stored invoice by id (owner or admin)' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.invoicesService.findOne(id, user.id, user.role === UserRole.ADMIN);
  }
}
