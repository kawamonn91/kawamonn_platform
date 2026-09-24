#!/usr/bin/env node
// Sends an alert email using the backend's existing SMTP credentials.
// Usage: node mailer.js "<subject>" "<body>"
const path = require('path');
const BACKEND_DIR = path.join(__dirname, '../kawamonn-storage-backend');
require(path.join(BACKEND_DIR, 'node_modules/dotenv')).config({ path: path.join(BACKEND_DIR, '.env') });
const nodemailer = require(path.join(BACKEND_DIR, 'node_modules/nodemailer'));

const [subject, body] = process.argv.slice(2);
if (!subject || !body) {
  console.error('Usage: node mailer.js "<subject>" "<body>"');
  process.exit(1);
}

const to = process.env.ALERT_EMAIL_TO || process.env.SMTP_USER;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter
  .sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    text: body,
  })
  .then(() => {
    console.log('Alert email sent to', to);
  })
  .catch((err) => {
    console.error('Failed to send alert email:', err.message);
    process.exit(1);
  });
