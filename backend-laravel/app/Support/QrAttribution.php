<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class QrAttribution
{
    public static function token(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^[a-f0-9]{32}$/D', $value) ? $value : null;
    }

    /** A bounded, inert value carried through the gate; ownership is checked at redirect admission. */
    public static function fromRequest(Request $request): ?string
    {
        return self::token($request->isMethod('POST') ? $request->input('qr') : $request->query('qr'));
    }

    public static function resolve(int $linkId, mixed $publicId): ?int
    {
        $token = self::token($publicId);
        if ($token === null) {
            return null;
        }
        $id = DB::table('qr_variants')->where('link_id', $linkId)->where('public_id', $token)->value('id');

        // Archived variants remain attributable: paper cannot be recalled.
        return $id === null ? null : (int) $id;
    }
}
