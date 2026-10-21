import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest
    .fn()
    .mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) }),
}));

describe('MailService', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.clearAllMocks();
  });

  it.each([
    ['465', true],
    ['587', false],
  ])('SMTP_PORT=%s なら secure=%s(465 番だけ最初から TLS)', (port, secure) => {
    process.env.SMTP_PORT = port;
    new MailService();
    const opts = (nodemailer.createTransport as jest.Mock).mock.calls.at(-1)[0];
    expect(opts).toMatchObject({ port: Number(port), secure });
  });

  it('差出人は「表示名 <SMTP_USER>」にする', async () => {
    process.env.SMTP_USER = 'sender@example.com';
    const mail = new MailService();
    await mail.send({
      fromName: 'UoA Online',
      to: 'a@example.com',
      subject: 's',
      text: 't',
    });
    const transporter = (
      nodemailer.createTransport as jest.Mock
    ).mock.results.at(-1)!.value;
    expect(transporter.sendMail).toHaveBeenCalledWith({
      from: '"UoA Online" <sender@example.com>',
      to: 'a@example.com',
      subject: 's',
      text: 't',
    });
  });
});
