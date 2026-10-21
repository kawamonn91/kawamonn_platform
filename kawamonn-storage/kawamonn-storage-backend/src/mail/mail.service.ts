import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface MailOptions {
  /** 差出人の表示名(アドレスは SMTP_USER) */
  fromName: string;
  to?: string;
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * メールの送信。SMTP の設定はここ1か所で読む(以前は認証・管理・定期処理がそれぞれ作り、
 * 465 番に固定されたものも残っていた)。監視の monitoring/mailer.js も同じ扱いにしている。
 */
@Injectable()
export class MailService {
  private readonly transporter: nodemailer.Transporter;

  constructor() {
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      // 465 番は最初から TLS、それ以外(587 など)は STARTTLS
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  /** 送る。失敗したら例外(呼び出し側で扱う) */
  async send(options: MailOptions): Promise<unknown> {
    const { fromName, ...rest } = options;
    return this.transporter.sendMail({
      from: `"${fromName}" <${process.env.SMTP_USER}>`,
      ...rest,
    });
  }
}
