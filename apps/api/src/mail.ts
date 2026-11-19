import nodemailer from 'nodemailer';
import type { Config } from './config.ts';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    requireTLS: config.SMTP_REQUIRE_TLS === 'true',
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
    },
  };
}
