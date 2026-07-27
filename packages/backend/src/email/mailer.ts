import nodemailer, { type Transporter } from 'nodemailer';
import { isEmailConfigured, getSmtpConfig } from './config.js';

let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transport) {
    const c = getSmtpConfig();
    transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user && c.pass ? { user: c.user, pass: c.pass } : undefined,
    });
  }
  return transport;
}

export function buildResetEmail(resetUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Сброс пароля — Skribo';
  const text = `Вы запросили сброс пароля в Skribo.\n\nПерейдите по ссылке, чтобы задать новый пароль (действует 1 час):\n${resetUrl}\n\nЕсли вы не запрашивали сброс — проигнорируйте это письмо.`;
  const html = `<p>Вы запросили сброс пароля в <b>Skribo</b>.</p>` +
    `<p><a href="${resetUrl}">Задать новый пароль</a> (ссылка действует 1 час).</p>` +
    `<p>Если вы не запрашивали сброс — проигнорируйте это письмо.</p>`;
  return { subject, html, text };
}

export async function sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const t = getTransport();
  if (!t) {
    console.warn('[email] SMTP not configured; skipping send to', msg.to);
    return;
  }
  await t.sendMail({ from: getSmtpConfig().from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendMail({ to, ...buildResetEmail(resetUrl) });
}
