import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AutocompleteQueryDto, AUTOCOMPLETE_MAX_LIMIT } from './autocomplete-query.dto';

describe('AutocompleteQueryDto (Issue #34) — limit validation', () => {
  const parse = (plain: Record<string, unknown>) =>
    plainToInstance(AutocompleteQueryDto, plain, { enableImplicitConversion: true });

  const errorProps = async (dto: object): Promise<string[]> =>
    (await validate(dto)).map((e) => e.property);

  it('accepts an empty query and leaves limit undefined', async () => {
    const dto = parse({});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBeUndefined();
  });

  it('coerces a valid string limit into a number', async () => {
    const dto = parse({ limit: '10' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(10);
  });

  it('accepts the maximum limit', async () => {
    const dto = parse({ limit: String(AUTOCOMPLETE_MAX_LIMIT) });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(AUTOCOMPLETE_MAX_LIMIT);
  });

  it('rejects a limit above the maximum', async () => {
    const dto = parse({ limit: String(AUTOCOMPLETE_MAX_LIMIT + 1) });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a limit of zero', async () => {
    const dto = parse({ limit: '0' });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a negative limit', async () => {
    const dto = parse({ limit: '-5' });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a non-integer limit (float)', async () => {
    const dto = parse({ limit: '10.7' });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a non-numeric limit string', async () => {
    const dto = parse({ limit: 'abc' });
    expect(await errorProps(dto)).toContain('limit');
  });
});
