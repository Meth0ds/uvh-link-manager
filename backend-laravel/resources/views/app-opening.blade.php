<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Abrir contenido · UVH</title>
@include('app-opening-style')
</head><body><main><span class="brand" aria-label="UVH">uvh.</span><div class="app-icon" aria-hidden="true">↗</div><h1>Continúa en {{ $label }}</h1><p>Abre el contenido en la aplicación o continúa en la web.</p>
@if($nativeUrl)<a class="primary" href="{{ $nativeUrl }}" rel="noreferrer">Abrir aplicación <span aria-hidden="true">↗</span></a>@else
<a class="primary" href="{{ $preparedUrl }}" rel="noreferrer">Abrir {{ $label }} <span aria-hidden="true">↗</span></a>
@endif
<a class="secondary" href="{{ $webPreparedUrl }}" rel="noreferrer">Abrir destino web</a>
<aside>La apertura depende de tu dispositivo y del navegador. Si estás dentro de otra aplicación, prueba a abrir este enlace en Safari o Chrome.</aside></main></body></html>
