import { getPublicUrl } from './site-config';

describe('getPublicUrl', () => {
  const originalEnv = process.env.PUBLIC_URL;

  afterEach(() => {
    process.env.PUBLIC_URL = originalEnv;
  });

  it('PUBLIC_URL が未設定の場合はデフォルト https://storage.kawamonn.com を返す', () => {
    delete process.env.PUBLIC_URL;
    expect(getPublicUrl()).toBe('https://storage.kawamonn.com');
  });

  it('PUBLIC_URL が設定されている場合はその値を返す(末尾のスラッシュは除去)', () => {
    process.env.PUBLIC_URL = 'https://custom.example.com/';
    expect(getPublicUrl()).toBe('https://custom.example.com');
  });
});
