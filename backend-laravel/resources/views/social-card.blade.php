<!doctype html>
<html lang="{{ app()->getLocale() === 'en_GB' ? 'en-GB' : 'es-ES' }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ $title }}</title>
<meta name="robots" content="noindex, nofollow, noarchive"><meta property="og:type" content="website"><meta property="og:title" content="{{ $title }}"><meta property="og:description" content="{{ $description }}">
@if ($canonical)<meta property="og:url" content="{{ $canonical }}">@endif
<meta name="twitter:card" content="{{ $image ? 'summary_large_image' : 'summary' }}"><meta name="twitter:title" content="{{ $title }}"><meta name="twitter:description" content="{{ $description }}">
@if ($image)<meta property="og:image" content="{{ $image }}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="{{ $alt }}"><meta name="twitter:image" content="{{ $image }}"><meta name="twitter:image:alt" content="{{ $alt }}">@endif
</head><body><main><h1>{{ $title }}</h1><p>{{ $description }}</p></main></body></html>
