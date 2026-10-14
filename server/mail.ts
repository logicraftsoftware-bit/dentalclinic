import nodemailer from 'nodemailer';
import { assert, prod } from './core.js';
export async function sendToken(email: string, token: string, purpose: string) {
  if (!process.env.SMTP_HOST) {
    assert(!prod, 503, 'Email service is not configured.');
    return { developmentToken: token };
  }
  const smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  await smtp.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject:
      purpose === 'VERIFY' ? 'Verify your DentaFlow account' : 'Reset your DentaFlow password',
    text: `Your ${purpose === 'VERIFY' ? 'verification' : 'password reset'} code: ${token}\nThis code expires in 30 minutes. Do not share it.`,
  });
  return {};
}
