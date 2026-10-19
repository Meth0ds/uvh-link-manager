<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

/** Presentation at the HTTP boundary; pure validators retain their stable source values. */
final class ResponseLanguage
{
    public static function apply(Response $response, string $language): Response
    {
        $previous = app()->getLocale();
        app()->setLocale(Language::locale($language));
        try {
            if (config('uvh.localisation_enabled') && $response instanceof JsonResponse && $response->getStatusCode() >= 400) {
                $body = $response->getData(true);
                if (is_array($body) && is_string($body['error'] ?? null)) {
                    $code = ApiErrorCode::forMessage($body['error']);
                    if ($code !== null) {
                        $body['error'] = __($code);
                        $response->setData($body + ['errorCode' => $code]);
                    }
                }
            }
            $response->setVary(implode(', ', array_unique([...$response->getVary(), 'Accept-Language', 'Cookie'])));
            $response->headers->set('Content-Language', Language::tag($language));

            return $response;
        } finally {
            app()->setLocale($previous);
        }
    }
}
