import test from 'node:test';
import assert from 'node:assert/strict';
import {nginxLocalisation} from './nginx-localisation.mjs';
import routes from '../../shared/localisation/routes.json' with {type:'json'};

test('public pages have exact static routes and retain legacy redirects',()=>{
 const config=nginxLocalisation('public');
 for(const translations of Object.values(routes))for(const language of ['es','en'])assert.ok(config.includes(`location = /${language}${translations[language]}`));
 assert.ok(config.includes('location = /help { return 308 /es/ayuda$is_args$args; }'));
 assert.ok(config.includes('location ^~ /legal/versions/ { try_files $uri =404;'));
 assert.ok(config.includes('error_page 404 =404'));
 assert.ok(config.includes('location = /en/legal/privacidad { return 308 /en/legal/privacy$is_args$args; }'));
 assert.ok(config.includes('location = /es/help { return 308 /es/ayuda$is_args$args; }'));
});

test('app keeps public navigation on the configured public origin, never a reflected Host',()=>{
 const config=nginxLocalisation('app');
 assert.ok(config.includes('return 302 https://${PUBLIC_HOST}/en/help'));
 assert.ok(config.includes('return 302 /es$request_uri'));
 assert.ok(!config.includes('https://$host'));
 assert.throws(()=>nginxLocalisation('../unsafe'));
});
