<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class UvhMail
{
    public static function send(string $to, string $subject, string $html, string $text): void
    {
        $link = self::extractLink($html);

        // Log mailer fallback: keeps flows working in preview without leaking
        // secrets. The one-time link is included so verification/reset/invitation
        // flows remain usable when no email provider is configured.
        // Never put bearer tokens (verification, reset or invitation) in logs.
        // The log fallback records only the origin/path so operators can
        // identify the message without turning log access into account access.
        Log::info('[mail:log]', ['to' => $to, 'subject' => $subject, 'url' => self::redactLink($link)]);

        $driver = (string) config('mail.default', 'log');
        if (in_array($driver, ['log', 'array'], true)) {
            return;
        }

        try {
            Mail::html($html, fn ($message) => $message->to($to)->subject($subject));
        } catch (\Throwable $e) {
            Log::error('[mail] send failed', ['error' => $e->getMessage()]);
        }
    }

    public static function verification(string $to, string $url): void
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Verificar email</a>';
        self::send(
            $to,
            'Verifica tu email en UVH',
            self::layout('Verifica tu cuenta', '<p>Haz clic para confirmar tu dirección de correo y activar tu cuenta.</p><p style="margin:18px 0">'.$link.'</p><p style="word-break:break-all;font-size:12px;color:#8A94A6">'.self::esc($url).'</p>'),
            "Verifica tu cuenta en UVH: {$url}",
        );
    }

    public static function resetPassword(string $to, string $url): void
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Restablecer contraseña</a>';
        self::send(
            $to,
            'Restablece tu contraseña en UVH',
            self::layout('Restablecer contraseña', '<p>Recibimos una solicitud para restablecer tu contraseña. El enlace caduca en 60 minutos.</p><p style="margin:18px 0">'.$link.'</p>'),
            "Restablece tu contraseña en UVH: {$url}",
        );
    }

    public static function invitation(string $to, string $url, string $workspace, string $role): void
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#00A99D;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Aceptar invitación</a>';
        self::send(
            $to,
            "Te invitaron al workspace {$workspace} en UVH",
            self::layout('Invitación de equipo', '<p>Has sido invitado a <strong>'.self::esc($workspace).'</strong> con rol <strong>'.self::esc($role).'</strong>.</p><p style="margin:18px 0">'.$link.'</p>'),
            "Te invitaron a {$workspace} (rol {$role}) en UVH: {$url}",
        );
    }

    private static function layout(string $title, string $body): string
    {
        return '<!doctype html><html><body style="font-family:Manrope,Segoe UI,Arial,sans-serif;background:#F6F8FC;padding:24px">'
            .'<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E3E8F0;border-radius:14px;padding:28px">'
            .'<p style="font-weight:800;color:#07111F;font-size:18px;margin:0 0 4px">UVH <span style="color:#2457F5">·</span> <span style="color:#00A99D">Enlaces cortos. Control total.</span></p>'
            .'<h1 style="color:#07111F;font-size:20px;margin:18px 0 8px">'.$title.'</h1>'
            .'<div style="color:#33415C;line-height:1.6">'.$body.'</div>'
            .'<p style="color:#8A94A6;font-size:12px;margin-top:24px">Si no solicitaste este correo, ignóralo.</p>'
            .'</div></body></html>';
    }

    private static function extractLink(string $html): ?string
    {
        if (preg_match('/href="([^"]+)"/', $html, $m)) {
            return $m[1];
        }

        return null;
    }

    private static function redactLink(?string $url): ?string
    {
        if ($url === null) {
            return null;
        }
        $parts = parse_url($url);
        if ($parts === false) {
            return '[redacted]';
        }
        $base = ($parts['scheme'] ?? 'https').'://'.($parts['host'] ?? '').($parts['path'] ?? '');

        $hasSensitivePart = isset($parts['query']) || isset($parts['fragment']);

        return $base.($hasSensitivePart ? '?[redacted]' : '');
    }

    private static function esc(string $v): string
    {
        return htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
