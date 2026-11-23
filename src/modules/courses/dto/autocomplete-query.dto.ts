import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AutocompleteQueryDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 25,
    description: 'Maximum suggestions to return; must be an integer between 1 and 25.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
}
