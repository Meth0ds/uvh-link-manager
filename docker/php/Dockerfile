# Imagen de desarrollo PHP para el backend Laravel de UVH.
# Incluye Composer y las extensiones necesarias para Laravel 13 + PostgreSQL.
#
# Las imágenes base van fijadas por digest y conservan la etiqueta: la etiqueta
# dice qué release es y el digest dice qué bytes son, así que una recompilación
# no puede traer una base distinta a la revisada. Dependabot propone la
# actualización cuando la etiqueta avanza y `scripts/check-image-digests.mjs`
# comprueba en CI que el digest sigue resolviendo.
FROM composer:2@sha256:aaeab4b6b031e0a88efb907f0f26b563532a644fc2f4ea0d000ecf8658f7a2b8 AS composer

FROM php:8.4.27-cli@sha256:1d7cdadb6f25e13425abcd9e7648955b7c297b6fb70e5a8f95b77f28df3bf8d8
# Security floor for CVE-2026-109618 / CVE-2026-109619 (PHP advisory, 2026-10-21).
# Fail closed if a future base change accidentally reintroduces an older runtime.
RUN php -r 'if (version_compare(PHP_VERSION, "8.4.27", "<")) { fwrite(STDERR, "PHP 8.4.27 or newer required\n"); exit(1); }'

# phpredis is not bundled with PHP: compile it and drop the build toolchain in
# the same layer, so local development uses the same client as production.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        unzip \
        libcurl4-openssl-dev \
        libicu-dev \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libonig-dev \
        libpq-dev \
        libzip-dev \
        $PHPIZE_DEPS \
    && docker-php-ext-configure gd --with-jpeg --with-freetype \
    && docker-php-ext-install -j"$(nproc)" \
        bcmath \
        curl \
        intl \
        gd \
        mbstring \
        opcache \
        pdo_pgsql \
        pgsql \
        zip \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && pecl clear-cache \
    && apt-get purge -y --auto-remove $PHPIZE_DEPS \
    && php -r 'exit(extension_loaded("redis") ? 0 : 1);' \
    && rm -rf /var/lib/apt/lists/* /tmp/pear

# Composer desde la imagen oficial, ya fijada por digest arriba. Se copia desde
# la etapa con nombre y no desde la referencia suelta para que la actualización
# que propone Dependabot sea una sola línea de `FROM ... AS composer`.
COPY --from=composer /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Motivo: esta imagen es sólo para desarrollo local y nunca se publica. Corre
# como root a propósito, para no pelear con los permisos de los volúmenes que
# monta el desarrollador. El artefacto que sí se despliega es
# `docker/php/Dockerfile.production`, que declara `USER www-data` y no lleva
# ninguna supresión.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["php", "-a"]
