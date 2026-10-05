<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ValidatesAuthInput;
use App\Support\Auth\AccountQueries;
use App\Support\Auth\AccountReadContext;
use App\Support\Auth\ProfileAdmission;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AccountProfileController
{
    use ValidatesAuthInput;

    public function me(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(AccountQueries::me($context));
    }

    public function profile(Request $request): JsonResponse
    {
        $name = trim(UvhRequest::inputString($request, 'name'));
        if (! $this->validName($name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $updated = ProfileAdmission::update($user, $sessionId, $name);
        if (! $updated) {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }

        return response()->json(['user' => UvhRequest::publicUser($updated)]);
    }
}
