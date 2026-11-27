import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const AUTOCOMPLETE_MAX_LIMIT = 25;
export const AUTOCOMPLETE_DEFAULT_LIMIT = 10;

/**
 * Query DTO for the autocomplete route.
 * Ensures that `limit` is a valid integer in [1, 25] before it reaches
 * SearchService, so the service no longer needs to handle garbage input.
 */
export class AutocompleteQueryDto {
  @ApiPropertyOptional({
    description: `Maximum number of suggestions to return (1–${AUTOCOMPLETE_MAX_LIMIT})`,
    default: AUTOCOMPLETE_DEFAULT_LIMIT,
    minimum: 1,
    maximum: AUTOCOMPLETE_MAX_LIMIT,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUTOCOMPLETE_MAX_LIMIT)
  limit?: number;
}
