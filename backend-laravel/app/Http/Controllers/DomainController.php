<?php

namespace App\Http\Controllers;

use App\Models\CustomDomain;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\UvhRequest;
use App\Support\WebhookService;
use Illuminate\Http\Request;

class DomainController
{
    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $domains = CustomDomain::where('workspace_id', $workspaceId)->orderByDesc('created_at')->get()->map(fn ($d) => $this->dto($d));

        return response()->json(['domains' => $domains]);
    }

    public function store(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $domain = strtolower(trim((string) $request->input('domain', ''), '.'));
        if (! preg_match('/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i', $domain)) {
            return response()->json(['error' => 'Dominio inválido'], 422);
        }

        if (CustomDomain::where('domain', $domain)->exists()) {
            return response()->json(['error' => 'Este dominio ya está registrado'], 409);
        }

        $token = 'uvh-verify='.Ids::randomToken(24);
        $d = CustomDomain::create([
            'workspace_id' => $workspaceId,
            'domain' => $domain,
            'verification_token' => $token,
            'state' => 'pending',
        ]);

        Audit::write($user->id, 'domain.create', 'domain', $d->id, ['domain' => $domain], UvhRequest::ip($request));

        return response()->json(['domain' => $this->dto($d)], 201);
    }

    public function verify(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $d = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $d) {
            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }

        $d->update(['state' => 'verifying', 'updated_at' => now()]);
        $found = $this->checkTxt($d->domain, $d->verification_token);

        if ($found) {
            $d->update(['state' => 'verified', 'verified_at' => now(), 'updated_at' => now()]);
            Audit::write($user->id, 'domain.verified', 'domain', $id, ['domain' => $d->domain], UvhRequest::ip($request));
            WebhookService::dispatch($workspaceId, 'domain.verified', ['domainId' => $id, 'domain' => $d->domain]);

            return response()->json(['ok' => true, 'state' => 'verified']);
        }

        $d->update(['state' => 'error', 'updated_at' => now()]);

        return response()->json([
            'ok' => false,
            'state' => 'error',
            'error' => 'Registro TXT no encontrado. Añade el registro TXT y vuelve a intentarlo.',
        ], 422);
    }

    public function activate(Request $request, int $id)
    {
        [$ok, $response] = $this->transition($request, $id, 'active', 'domain.activate');
        if (! $ok) {
            return $response;
        }

        return response()->json(['ok' => true, 'state' => 'active']);
    }

    public function disable(Request $request, int $id)
    {
        [$ok, $response] = $this->transition($request, $id, 'disabled', 'domain.disable');
        if (! $ok) {
            return $response;
        }

        return response()->json(['ok' => true, 'state' => 'disabled']);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $d = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $d) {
            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }

        $d->delete();
        Audit::write($user->id, 'domain.delete', 'domain', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function revalidate(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $d = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $d) {
            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }

        $found = $this->checkTxt($d->domain, $d->verification_token);
        $next = $found ? 'verified' : 'error';
        $d->update(['state' => $next, 'updated_at' => now()]);
        Audit::write($user->id, 'domain.revalidate', 'domain', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true, 'state' => $next]);
    }

    private function transition(Request $request, int $id, string $target, string $auditAction): array
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $d = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $d) {
            return [false, response()->json(['error' => 'Dominio no encontrado'], 404)];
        }
        if ($target === 'active' && $d->state !== 'verified') {
            return [false, response()->json(['error' => 'El dominio debe estar verificado antes de activarlo'], 422)];
        }

        $d->update(['state' => $target, 'updated_at' => now()]);
        Audit::write($user->id, $auditAction, 'domain', $id, null, UvhRequest::ip($request));

        return [true, null];
    }

    private function checkTxt(string $domain, string $token): bool
    {
        try {
            $records = dns_get_record($domain, DNS_TXT);
            foreach ($records as $record) {
                $txt = is_array($record['txt'] ?? null) ? implode('', $record['txt']) : (string) ($record['txt'] ?? '');
                if (str_contains(trim($txt, '"'), $token)) {
                    return true;
                }
            }
        } catch (\Throwable) {
            return false;
        }

        return false;
    }

    private function dto(CustomDomain $d): array
    {
        return [
            'id' => $d->id,
            'domain' => $d->domain,
            'state' => $d->state,
            'verificationToken' => $d->verification_token,
            'verifiedAt' => $this->iso($d->verified_at),
            'createdAt' => $this->iso($d->created_at),
        ];
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof \DateTimeInterface
            ? $value->format('Y-m-d\TH:i:s.v\Z')
            : (string) $value;
    }
}
