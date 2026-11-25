import { BadRequestException } from '@nestjs/common';
import { validateFileMimeType } from './mime-validator';

// 1x1 transparent PNG
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Plain text payload that file-type cannot identify as an allowed type
const DISALLOWED_BUFFER = Buffer.from('this is definitely not an image or pdf');

describe('validateFileMimeType', () => {
  it('resolves for an allowed PNG buffer', async () => {
    await expect(validateFileMimeType(PNG_BUFFER, 'template.png')).resolves.toBeUndefined();
  });

  it('throws BadRequestException for a disallowed buffer', async () => {
    await expect(validateFileMimeType(DISALLOWED_BUFFER, 'template.txt')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
