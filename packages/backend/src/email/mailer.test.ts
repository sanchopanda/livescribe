import { describe, it, expect, afterEach } from 'vitest';
import { isEmailConfigured } from './config.js';
import { buildResetEmail } from './mailer.js';

afterEach(() => { delete process.env.SMTP_HOST; delete process.env.SMTP_FROM; });

describe('isEmailConfigured', () => {
  it('false without host/from', () => { expect(isEmailConfigured()).toBe(false); });
  it('true with host + from', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'no-reply@skribo.ru';
    expect(isEmailConfigured()).toBe(true);
  });
});

describe('buildResetEmail', () => {
  it('embeds the reset url in html and text', () => {
    const url = 'https://app.skribo.ru/reset?token=abc123';
    const { subject, html, text } = buildResetEmail(url);
    expect(subject).toContain('Skribo');
    expect(html).toContain(url);
    expect(text).toContain(url);
  });
});
