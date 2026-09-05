# Imagen de desarrollo PHP para el backend Laravel de UVH.
# Incluye Composer y las extensiones necesarias para Laravel 13 + PostgreSQL.
FROM php:8.4-cli

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        unzip \
        libcurl4-openssl-dev \
        libicu-dev \
        libonig-dev \
        libpq-dev \
        libzip-dev \
    && docker-php-ext-install -j"$(nproc)" \
        bcmath \
        curl \
        intl \
        mbstring \
        opcache \
        pdo_pgsql \
        pgsql \
        zip \
    && rm -rf /var/lib/apt/lists/*

# Composer desde la imagen oficial.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

CMD ["php", "-a"]
