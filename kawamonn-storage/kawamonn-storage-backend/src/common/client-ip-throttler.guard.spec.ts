import { clientIpOf } from './client-ip-throttler.guard';

describe('clientIpOf', () => {
  it('Pi の中(画面のサーバー)から届いたら、Cloudflare が付けた接続元で数える', () => {
    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(
        clientIpOf({
          socket: { remoteAddress: remote },
          headers: { 'cf-connecting-ip': '203.0.113.7' },
        }),
      ).toBe('203.0.113.7');
    }
  });

  it('Cloudflare を通っていなければ(ヘッダーが無ければ)、直接の接続元で数える', () => {
    expect(
      clientIpOf({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }),
    ).toBe('127.0.0.1');
  });

  it('外から直接届いたものの CF-Connecting-IP は信用しない(偽れるため)', () => {
    expect(
      clientIpOf({
        socket: { remoteAddress: '100.64.1.2' },
        headers: { 'cf-connecting-ip': '1.2.3.4' },
      }),
    ).toBe('100.64.1.2');
  });
});
