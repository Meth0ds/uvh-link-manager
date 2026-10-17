import routes from '../../shared/localisation/routes.json' with {type:'json'};
import {mkdir,writeFile} from 'node:fs/promises';

export function nginxLocalisation(surface){
 if(!['app','public'].includes(surface))throw new Error('Invalid nginx surface');
 const lines=['# Generated from shared/localisation/routes.json; do not edit by hand.'];
 const legacy={'/help':'help','/help/':'help','/status':'status','/status/':'status','/legal':'terms','/legal/':'terms','/legal/terminos':'terms','/legal/terminos/':'terms','/legal/privacidad':'privacy','/legal/privacidad/':'privacy','/legal/denuncias':'reportAbuse','/legal/denuncias/':'reportAbuse'};
 const publicTarget=surface==='app'?'https://${PUBLIC_HOST}':'';
 for(const language of ['es','en']){
  lines.push(`location = /${language} { return 308 /${language}/$is_args$args; }`);
  for(const translations of Object.values(routes)){
   const route=translations[language];
   if(!/^\/(?:[a-z-]+\/?)*$/.test(route))throw new Error('Unsafe manifest path');
   const local='/'+language+route;
   if(surface==='app')lines.push(`location = ${local} { return 302 https://\u0024{PUBLIC_HOST}${local}$is_args$args; }`);
   else lines.push(`location = ${local} { try_files ${local.replace(/\/$/,'')}/index.html =404; expires -1; }`);
   if(route!=='/')lines.push(`location = ${local}/ { return 308 ${publicTarget}${local}$is_args$args; }`);
   const alternate=translations[language==='es'?'en':'es'];
   if(alternate!==route){
    for(const suffix of ['', '/'])lines.push(`location = /${language}${alternate}${suffix} { return 308 ${publicTarget}${local}$is_args$args; }`);
   }
  }
 }
 for(const [old,id]of Object.entries(legacy))lines.push(`location = ${old} { return 308 ${publicTarget}/es${routes[id].es}$is_args$args; }`);
 for(const language of ['es','en']){
  lines.push(`location = /${language}/forbidden { error_page 403 =403 @uvh_localised_not_found; return 403; }`);
  lines.push(`location = /${language}/not-found { error_page 404 =404 @uvh_localised_not_found; return 404; }`);
 }
 lines.push('location = /forbidden { return 302 /es/forbidden$is_args$args; }');
 lines.push('location = /not-found { return 302 /es/not-found$is_args$args; }');
 lines.push('location ^~ /legal/versions/ { try_files $uri =404; expires -1; }');
 if(surface==='app'){
  lines.push('location ~ ^/(?:es|en)/(?:app|auth|reports|invitations)(?:/|$) { try_files /$uvh_ui_language/index.csr.html =404; expires -1; }');
  lines.push('location ~ ^/(?:app|auth|reports|invitations)(?:/|$) { return 302 /es$request_uri; }');
 }else{
  lines.push('location ~ ^/(?:es|en)/(?:app|auth|reports|invitations)(?:/|$) { return 302 https://${APP_HOST}$request_uri; }');
  lines.push('location ~ ^/(?:app|auth|reports|invitations)(?:/|$) { return 302 https://${APP_HOST}/es$request_uri; }');
 }
 lines.push('location ~ ^/(?:es|en)(?:/|$) { error_page 404 =404 @uvh_localised_not_found; try_files $uri $uri/index.html =404; expires -1; }');
 lines.push('location @uvh_localised_not_found { try_files /$uvh_ui_language/index.csr.html =404; expires -1; }');
 return lines.join('\n')+'\n';
}
if(process.argv[1]?.endsWith('/nginx-localisation.mjs')){
 const root=new URL('../dist/uvh/nginx/',import.meta.url);await mkdir(root,{recursive:true});
 for(const surface of ['app','public'])await writeFile(new URL(surface+'.conf.template',root),nginxLocalisation(surface));
}
