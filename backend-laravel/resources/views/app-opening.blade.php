<!doctype html>
<html lang="{{ app()->getLocale() === 'en_GB' ? 'en-GB' : 'es-ES' }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>{{ __('visitor.open_title') }} · UVH</title>
@include('app-opening-style')
</head><body><main><span class="brand" aria-label="UVH">uvh.</span><div class="app-icon" aria-hidden="true">↗</div><h1>{{ __('visitor.open_heading', ['label' => $label]) }}</h1><p>{{ __('visitor.open_body') }}</p>
@if($nativeUrl)<a class="primary" href="{{ $nativeUrl }}" rel="noreferrer">{{ __('visitor.open_app') }} <span aria-hidden="true">↗</span></a>@else
<a class="primary" href="{{ $preparedUrl }}" rel="noreferrer">{{ __('visitor.open_provider', ['label' => $label]) }} <span aria-hidden="true">↗</span></a>
@endif
<a class="secondary" href="{{ $webPreparedUrl }}" rel="noreferrer">{{ __('visitor.open_web') }}</a>
<aside>{{ __('visitor.open_hint') }}</aside></main></body></html>
