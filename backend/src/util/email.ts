import { Resend } from "resend";
import { config } from "../config.js";

let resend: Resend | null = null;
if (config.resendApiKey) {
  resend = new Resend(config.resendApiKey);
}

export function emailConfigured(): boolean {
  return resend !== null;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  if (!resend) {
    // Log mailer fallback: keeps flows working in preview without leaking
    // secrets. JSON.stringify prevents CR/LF log injection via user content.
    console.log("[mail:log]", JSON.stringify({ to: msg.to, subject: msg.subject }));
    return;
  }
  try {
    await resend.emails.send({
      from: config.mailFrom,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  } catch (err) {
    console.error("[mail] send failed", err);
  }
}

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:Manrope,Segoe UI,Arial,sans-serif;background:#F6F8FC;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E3E8F0;border-radius:14px;padding:28px">
    <p style="font-weight:800;color:#07111F;font-size:18px;margin:0 0 4px">UVH <span style="color:#2457F5">·</span> <span style="color:#00A99D">Enlaces cortos. Control total.</span></p>
    <h1 style="color:#07111F;font-size:20px;margin:18px 0 8px">${title}</h1>
    <div style="color:#33415C;line-height:1.6">${body}</div>
    <p style="color:#8A94A6;font-size:12px;margin-top:24px">Si no solicitaste este correo, ignóralo.</p>
  </div></body></html>`;
}

export function verificationEmail(to: string, url: string): MailMessage {
  const link = `<a href="${esc(url)}" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Verificar email</a>`;
  return {
    to,
    subject: "Verifica tu email en UVH",
    html: layout("Verifica tu cuenta", `<p>Haz clic para confirmar tu dirección de correo y activar tu cuenta.</p><p style="margin:18px 0">${link}</p><p style="word-break:break-all;font-size:12px;color:#8A94A6">${esc(url)}</p>`),
    text: `Verifica tu cuenta en UVH: ${url}`,
  };
}

export function resetPasswordEmail(to: string, url: string): MailMessage {
  const link = `<a href="${esc(url)}" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Restablecer contraseña</a>`;
  return {
    to,
    subject: "Restablece tu contraseña en UVH",
    html: layout("Restablecer contraseña", `<p>Recibimos una solicitud para restablecer tu contraseña. El enlace caduca en 60 minutos.</p><p style="margin:18px 0">${link}</p>`),
    text: `Restablece tu contraseña en UVH: ${url}`,
  };
}

export function invitationEmail(to: string, url: string, workspace: string, role: string): MailMessage {
  const link = `<a href="${esc(url)}" style="display:inline-block;background:#00A99D;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Aceptar invitación</a>`;
  return {
    to,
    subject: `Te invitaron al workspace ${workspace} en UVH`,
    html: layout("Invitación de equipo", `<p>Has sido invitado a <strong>${esc(workspace)}</strong> con rol <strong>${esc(role)}</strong>.</p><p style="margin:18px 0">${link}</p>`),
    text: `Te invitaron a ${workspace} (rol ${role}) en UVH: ${url}`,
  };
}

/** Escape user-controlled values before interpolating them into HTML. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
