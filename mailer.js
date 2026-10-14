const nodemailer = require("nodemailer");

let transporter = null;

function isEnabled() {
    return Boolean(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS
    );
}

function getTransporter() {
    if (transporter) return transporter;

    if (!isEnabled()) {
        console.warn("Email disabled: SMTP not configured");
        return null;
    }

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE) === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    return transporter;
}

async function sendVerificationEmail({ to, name, token }) {
    const transport = getTransporter();

    if (!transport) {
        console.warn("Email not sent: SMTP not configured");
        return { sent: false, reason: "SMTP not configured" };
    }

    const appUrl = process.env.APP_URL || "http://localhost:9000";
    const verifyUrl = `${appUrl}/?verify=${encodeURIComponent(token)}`;

    const html = `
    <!doctype html>
    <html>
    <body style="margin:0;padding:0;background:#05070a;font-family:Inter,Arial,sans-serif;">
      <div style="max-width:560px;margin:40px auto;background:#0b1118;border:1px solid #263241;border-radius:16px;padding:36px;color:#e2e8f0;">
        <p style="font-size:11px;letter-spacing:0.16em;color:#60a5fa;margin:0 0 8px;font-weight:700;">PRIVATE AI WORKSPACE</p>
        <h1 style="margin:0 0 16px;font-size:26px;color:#f8fafc;">Welcome to Roxan, ${name}!</h1>
        <p style="color:#94a3b8;line-height:1.6;">Thanks for signing up. Please verify your email address to activate your account.</p>
        <p style="margin:28px 0;">
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:linear-gradient(90deg,#2563eb,#38bdf8);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Verify Email</a>
        </p>
        <p style="color:#64748b;font-size:13px;line-height:1.6;">Or paste this link in your browser:</p>
        <p style="color:#60a5fa;font-size:12px;word-break:break-all;">${verifyUrl}</p>
        <p style="color:#64748b;font-size:12px;margin-top:28px;">This link expires in 24 hours. If you did not create an account, ignore this email.</p>
      </div>
    </body>
    </html>
    `;

    try {
        const info = await transport.sendMail({
            from: process.env.EMAIL_FROM || "Roxan <noreply@roxan.local>",
            to,
            subject: "Verify your Roxan account",
            html
        });

        console.log(`📧 Verification email sent to ${to}: ${info.messageId}`);
        return { sent: true, messageId: info.messageId };
    } catch (error) {
        console.error("Email send failed:", error.message);
        return { sent: false, reason: error.message };
    }
}

module.exports = {
    isEnabled,
    sendVerificationEmail
};