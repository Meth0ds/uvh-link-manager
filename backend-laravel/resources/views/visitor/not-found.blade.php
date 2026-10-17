<!doctype html>
<html lang="{{ app()->getLocale() === 'en_GB' ? 'en-GB' : 'es-ES' }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="color-scheme" content="light dark">
    <title>{{ __('visitor.not_found_title') }} · {{ $brandHost ?? 'UVH' }}</title>
    <link rel="stylesheet" href="/visitor-assets/not-found.v1.css">
    <style>@font-face{font-family:Manrope;font-style:normal;font-weight:400;font-display:swap;src:url('/visitor-assets/manrope-400.woff2') format('woff2')}@font-face{font-family:Manrope;font-style:normal;font-weight:600;font-display:swap;src:url('/visitor-assets/manrope-600.woff2') format('woff2')}@font-face{font-family:Manrope;font-style:normal;font-weight:800;font-display:swap;src:url('/visitor-assets/manrope-800.woff2') format('woff2')}body{margin:0}</style>
    <script type="module" src="/visitor-assets/bootstrap.v1.mjs"></script>
</head>
<body>
<div class="nf-page{{ $brandHost ? ' nf-page-neutral' : '' }}">
    <a class="nf-skip" href="#not-found-content">{{ __('visitor.skip') }}</a>
    <header class="nf-header">
        @if($brandHost)
            <span class="nf-brand nf-brand-custom">{{ $brandHost }}</span>
        @else
            <a class="nf-brand" href="{{ $homeUrl }}" aria-label="{{ __('visitor.home_accessible') }}">uvh<span>.</span></a>
            <a class="nf-header-link" href="{{ $helpUrl }}">{{ __('visitor.need_help') }}</a>
        @endif
    </header>
    <main id="not-found-content" class="nf-main" tabindex="-1">
        <section class="nf-copy" aria-labelledby="not-found-title">
            <p class="nf-eyebrow"><span>404</span> {{ __('visitor.eyebrow') }}</p>
            <h1 id="not-found-title">{{ __('visitor.not_found_title') }}<span aria-hidden="true">.</span></h1>
            <p class="nf-lead">{{ __('visitor.not_found_body') }}</p>
            <div class="nf-actions">
                @if($brandHost)
                    @if($root)<a class="nf-button nf-button-primary" href="{{ $root }}" rel="noreferrer">{{ __('visitor.back_site') }} <span aria-hidden="true">↗</span></a>@endif
                @else
                    <a class="nf-button nf-button-primary" href="{{ $homeUrl }}">{{ __('visitor.back_home') }} <span aria-hidden="true">→</span></a>
                    <a class="nf-button" href="{{ $panelUrl }}">{{ __('visitor.dashboard') }}</a>
                @endif
            </div>
            @unless($brandHost)<p class="nf-help">{{ __('visitor.expected_elsewhere') }} <a href="{{ $helpUrl }}">{{ __('visitor.help_action') }}</a></p>@endunless
        </section>
        <figure class="nf-scene" aria-labelledby="puzzle-caption">
            <figcaption class="nf-scene-caption" id="puzzle-caption">{{ __('visitor.puzzle_invitation') }}</figcaption>
            <div class="nf-figure"><span class="nf-digit" aria-hidden="true">4</span>
                <div class="nf-game" data-route-puzzle>
                    <img class="nf-fallback" src="/visitor-assets/puzzle-static.v1.svg" width="270" height="270" alt="{{ __('visitor.puzzle_image_alt') }}">
                    <p class="nf-static-help">{{ __('visitor.puzzle_static_help') }}</p>
                </div>
                <span class="nf-digit" aria-hidden="true">4</span>
            </div>
        </figure>
    </main>
    <footer class="nf-footer">
        <p class="nf-footer-note">{{ $brandHost ?? __('visitor.footer') }}</p>
        @unless($brandHost)<nav class="nf-footer-links" aria-label="{{ __('visitor.help_links') }}"><a href="{{ $helpUrl }}">{{ __('visitor.help') }}</a><a href="{{ $privacyUrl }}">{{ __('visitor.privacy') }}</a></nav>@endunless
    </footer>
</div>
</body>
</html>
