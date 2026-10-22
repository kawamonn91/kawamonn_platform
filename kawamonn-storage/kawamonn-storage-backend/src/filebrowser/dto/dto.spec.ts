import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MkdirDto, RenameDto, WriteTextDto } from './filebrowser.dto';

describe('FileBrowser DTOs', () => {
  it('MkdirDto validates non-empty string path', async () => {
    expect(
      await validate(plainToInstance(MkdirDto, { path: '/docs' })),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(MkdirDto, { path: '' })),
    ).toHaveLength(1);
    expect(
      await validate(plainToInstance(MkdirDto, { path: 123 })),
    ).toHaveLength(1);
  });

  it('WriteTextDto validates string path and optional string content', async () => {
    expect(
      await validate(
        plainToInstance(WriteTextDto, { path: '/a.txt', content: 'hi' }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(WriteTextDto, { path: '/a.txt' })),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(WriteTextDto, { path: '/a.txt', content: { bad: 1 } }),
      ),
    ).toHaveLength(1);
  });

  it('RenameDto validates oldPath and newPath strings', async () => {
    expect(
      await validate(
        plainToInstance(RenameDto, { oldPath: '/a', newPath: '/b' }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(RenameDto, { oldPath: '/a' })),
    ).toHaveLength(1);
  });
});
