import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AutocompleteQueryDto } from './autocomplete-query.dto';

describe('AutocompleteQueryDto (Issue #34) — limit validation', () => {
  const parse = (plain: Record<string, unknown>) =>
    plainToInstance(AutocompleteQueryDto, plain, { enableImplicitConversion: true });

  const errorProps = async (dto: object): Promise<string[]> =>
    (await validate(dto)).map((e) => e.property);

  it('accepts an empty query (limit is optional)', async () => {
    const dto = parse({});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBeUndefined();
  });

  it('accepts a valid integer limit', async () => {
    const dto = parse({ limit: '10' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(10);
  });

  it('accepts limit at the minimum boundary (1)', async () => {
    const dto = parse({ limit: '1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts limit at the maximum boundary (25)', async () => {
    const dto = parse({ limit: '25' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-numeric limit with a 400', async () => {
    const dto = parse({ limit: 'abc' });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a float limit', async () => {
    const dto = parse({ limit: '10.7' });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a limit below 1', async () => {
    const dto = parse({ limit: '0' });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a negative limit', async () => {
    const dto = parse({ limit: '-5' });
    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a limit above 25', async () => {
    const dto = parse({ limit: '26' });
    expect(await errorProps(dto)).toContain('limit');
  });
});
