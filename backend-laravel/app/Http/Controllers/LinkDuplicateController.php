<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\Link;
use App\Support\LinkPreferences;
use App\Support\LinkService;
use App\Support\QrDesign;
use App\Support\UvhRequest;
use App\Support\WorkspaceMutation;
use App\Support\WorkspaceWriteActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class LinkDuplicateController extends LinkController
{
    public function duplicate(Request $request, int $id): JsonResponse
    {
        try {
            LinkPreferences::enabled();
            $key = QrDesign::requestKey($request->header('Idempotency-Key'));
            $action = $request->input('passwordAction', 'keep');
            if (! is_int($request->input('sourceVersion')) || $request->input('sourceVersion') < 1
                || ! in_array($action, ['keep', 'replace', 'remove'], true)) {
                throw new LinkException('Datos de duplicación inválidos.', 422);
            }
            $body = Request::create('/', 'POST', $request->except(['sourceVersion', 'passwordAction']));
            if ($this->unsupportedBodyField($body) !== null || ! $this->validLinkBody($body, true)) {
                throw new LinkException('Datos de duplicación inválidos.', 422);
            }
            if ($action === 'replace' && (! is_string($request->input('password')) || $request->input('password') === '' || strlen($request->input('password')) > 72)
                || ($action !== 'replace' && $request->has('password'))) {
                throw new LinkException('Elige mantener, sustituir o quitar la contraseña.', 422);
            }
            $workspaceId = UvhRequest::workspaceId($request);
            $user = UvhRequest::user($request);
            // The fingerprint is an HMAC: a database leak cannot brute-force passwords.
            $hash = hash_hmac('sha256', json_encode([$id, $request->all()], JSON_THROW_ON_ERROR), (string) config('app.key'));
            $link = WorkspaceMutation::run($request, function () use ($request, $body, $id, $key, $hash, $workspaceId, $user, $action): Link {
                $receipt = DB::table('link_duplicate_receipts')->where('workspace_id', $workspaceId)->where('user_id', $user->id)->where('idempotency_key', $key)->first();
                if ($receipt) {
                    if (! hash_equals($receipt->request_hash, $hash)) {
                        throw new LinkException('Esta clave corresponde a otra duplicación.', 409);
                    }
                    $previous = Link::where('workspace_id', $workspaceId)->where('id', $receipt->link_id)->first();
                    if (! $previous) {
                        throw new LinkException('La copia creada con esta clave fue eliminada.', 410);
                    }

                    return $previous;
                }
                $source = Link::where('workspace_id', $workspaceId)->where('id', $id)->lockForUpdate()->first();
                if (! $source) {
                    throw new LinkException('Enlace no encontrado.', 404);
                }
                if ($source->state === 'blocked' || $source->state === 'deleted') {
                    throw new LinkException('No se puede duplicar un enlace bloqueado o eliminado.', 403);
                }
                if ((int) $source->version !== $request->input('sourceVersion')) {
                    throw new LinkException('El enlace original cambió. Recarga antes de duplicarlo.', 409);
                }
                $input = $this->inputFromRequest($body, $source);
                $input['alias'] = $body->has('alias') ? $body->input('alias') : null;
                $input['tags'] = $body->has('tags') ? $body->input('tags') : $source->tags->pluck('name')->all();
                $input['rules'] = $body->has('rules') ? $body->input('rules') : $source->rules->map(fn ($rule) => $rule->only(['priority', 'country', 'language', 'device', 'os', 'time_from', 'time_to', 'referrer', 'campaign', 'destination']))->all();
                $input['password_hash'] = match ($action) {
                    'keep' => $source->password_hash,
                    'remove' => null,
                    'replace' => Hash::make($request->input('password')),
                };
                $validation = LinkService::validate($input);
                if (! $validation['ok']) {
                    throw new LinkException($validation['error'], 422);
                }
                $created = LinkService::create($workspaceId, (int) $user->id, $input, UvhRequest::apiToken($request), (int) $user->security_version, WorkspaceWriteActor::fromRequest($request), 'duplicate');
                $copy = Link::findOrFail($created['id']);
                if (in_array($source->state, ['paused', 'archived'], true)) {
                    $copy->update(['state' => $source->state]);
                }
                DB::table('link_duplicate_receipts')->insert(['workspace_id' => $workspaceId, 'user_id' => $user->id, 'source_link_id' => $id, 'link_id' => $copy->id, 'idempotency_key' => $key, 'request_hash' => $hash, 'created_at' => now()]);
                WorkspaceWriteActor::fromRequest($request)->auditLink('link.duplicate', (int) $copy->id, ['sourceLinkId' => $id]);

                return $copy;
            });

            return response()->json(['link' => LinkService::dto($link)], 201);
        } catch (LinkException $error) {
            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }
}
