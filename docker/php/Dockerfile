# Imagen de desarrollo PHP para el backend Laravel de UVH.
# Incluye Composer y las extensiones necesarias para Laravel 13 + PostgreSQL.
FROM php:8.4-cli

# phpredis is not bundled with PHP: compile it and drop the build toolchain in
# the same layer, so local development uses the same client as production.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        unzip \
        libcurl4-openssl-dev \
        libicu-dev \
        libonig-dev \
        libpq-dev \
        libzip-dev \
        $PHPIZE_DEPS \
    && docker-php-ext-install -j"$(nproc)" \
        bcmath \
        curl \
        intl \
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

# Composer desde la imagen oficial.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

CMD ["php", "-a"]
