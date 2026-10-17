<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\Collection;
use App\Models\LinkTemplate;
use App\Support\AppOpening;
use App\Support\Audit;
use App\Support\LinkName;
use App\Support\LinkService;
use App\Support\SocialPreview;
use App\Support\UvhRequest;
use App\Support\WorkspaceLimits;
use App\Support\WorkspaceMutation;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Plantillas de enlace (F7): valores por defecto con los que empezar un
 * enlace. El payload se valida con las MISMAS reglas que un enlace real al
 * guardar la plantilla, y nunca lleva alias —el alias identifica un enlace
 * concreto y copiarlo chocaría al instante—.
 */
class LinkTemplateController
{
    /** Campos que una plantilla puede guardar; lo demás se rechaza. */
    private const PAYLOAD_KEYS = ['destination', 'fallback_destination', 'notes', 'tags', 'utm', 'max_clicks', 'single_use', 'scheduled_at', 'expires_at', 'collection_id', 'name', 'social_preview', 'app_opening'];

    public function index(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $templates = LinkTemplate::where('workspace_id', $workspaceId)
            ->orderBy('name')->orderBy('id')->get()
            ->map(fn (LinkTemplate $template): array => [
                'id' => (int) $template->id,
                'name' => $template->name,
                'payload' => $template->payload,
                'createdAt' => $template->created_at->toIso8601String(),
            ]);

        return response()->json(['templates' => $templates->values()->all()]);
    }

    public function store(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $name = $request->input('name');
        if (! is_string($name) || ! mb_check_encoding($name, 'UTF-8')
            || mb_strlen(trim($name)) < 1 || mb_strlen($name) > 60
            || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            return response()->json(['error' => __('messages.error_7a780acb053959')], 422);
        }
        $name = trim($name);

        $payload = $request->input('payload');
        if (! is_array($payload)) {
            return response()->json(['error' => __('messages.error_b2802f95e9af19')], 422);
        }
        foreach (array_keys($payload) as $key) {
            if (! in_array($key, self::PAYLOAD_KEYS, true)) {
                return response()->json(['error' => 'Campo no admitido en plantilla: '.$key], 422);
            }
        }
        if (array_key_exists('alias', $payload)) {
            return response()->json(['error' => __('messages.error_a29ed0885a24ab')], 422);
        }

        $collectionId = $payload['collection_id'] ?? null;
        if ($collectionId !== null && (! is_int($collectionId) || $collectionId < 1)) {
            return response()->json(['error' => __('messages.error_d5a81f23c4dfd2')], 422);
        }
        if ($collectionId !== null && ! Collection::where('id', $collectionId)->where('workspace_id', $workspaceId)->exists()) {
            return response()->json(['error' => __('messages.error_6568a0022eb114')], 422);
        }

        // La plantilla se guarda ya validada: aplicarla luego no puede
        // descubrir un destino imposible ni un UTM corrupto.
        $check = LinkService::validate($payload);
        if (! $check['ok']) {
            return response()->json(['error' => $check['error']], 422);
        }

        if (LinkTemplate::where('workspace_id', $workspaceId)->whereRaw('lower(name) = lower(?)', [$name])->exists()) {
            return response()->json(['error' => __('messages.error_7ac92dfe486f06')], 409);
        }

        try {
            $template = WorkspaceMutation::run($request, function () use ($workspaceId, $user, $name, $payload, $collectionId): LinkTemplate {
                if ($collectionId !== null && ! Collection::where('workspace_id', $workspaceId)->where('id', $collectionId)->lockForUpdate()->first()) {
                    throw new LinkException(__('messages.error_6568a0022eb114'), 422);
                }

                if (LinkTemplate::where('workspace_id', $workspaceId)->count() >= WorkspaceLimits::limit('templates')) {
                    throw new LinkException(__('messages.error_dd5db010a48f5c'), 409);
                }

                if (array_key_exists('app_opening', $payload)) {
                    $spec = $payload['app_opening'];
                    $domain = is_array($spec) && ($spec['kind'] ?? '') === 'native' && is_string($spec['profileId'] ?? null) && Str::isUuid($spec['profileId'])
                        ? DB::table('app_link_profiles')->where('public_id', $spec['profileId'])->where('workspace_id', $workspaceId)->value('domain_id') : null;
                    $payload['app_opening'] = AppOpening::validate($spec, $workspaceId, $domain === null ? null : (int) $domain);
                }
                if (array_key_exists('social_preview', $payload)) {
                    $payload['social_preview'] = SocialPreview::validate($payload['social_preview'], $workspaceId);
                }

                return LinkTemplate::create([
                    'workspace_id' => $workspaceId,
                    'created_by' => (int) $user->id,
                    'name' => $name,
                    'payload' => array_key_exists('name', $payload) ? array_replace($payload, ['name' => LinkName::normalize($payload['name'])]) : $payload,
                ]);
            }, function (LinkTemplate $template) use ($request, $user, $workspaceId, $name): void {
                Audit::write($user->id, 'link_template.create', 'link_template', (int) $template->id, ['name' => $name], UvhRequest::ip($request), workspaceId: $workspaceId);
            });
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (QueryException $e) {
            // La comprobación previa y la escritura no son atómicas: si otra
            // petición tomó el nombre en ese hueco, el índice único es el que
            // decide y el resultado es un conflicto, no un error 500.
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => __('messages.error_7ac92dfe486f06')], 409);
            }
            throw $e;
        }

        return response()->json(['template' => [
            'id' => (int) $template->id,
            'name' => $template->name,
            'payload' => $template->payload,
            'createdAt' => $template->created_at->toIso8601String(),
        ]], 201);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $template = LinkTemplate::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $template) {
            return response()->json(['error' => __('messages.error_0416a2955b9c45')], 404);
        }
        try {
            WorkspaceMutation::run($request, function () use ($workspaceId, $id): void {
                $template = LinkTemplate::where('workspace_id', $workspaceId)->where('id', $id)->lockForUpdate()->first();
                if (! $template) {
                    throw new LinkException(__('messages.error_0416a2955b9c45'), 404);
                }
                $template->delete();
            }, function () use ($request, $user, $workspaceId, $id): void {
                Audit::write($user->id, 'link_template.delete', 'link_template', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);
            });
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }

        return response()->json(['ok' => true]);
    }
}
