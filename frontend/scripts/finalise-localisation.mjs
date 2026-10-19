import {readFile,writeFile,stat} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import copy from '../src/locale/document-copy.json' with {type:'json'};
import routes from '../../shared/localisation/routes.json' with {type:'json'};

const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const LANGUAGE_TAGS={es:'es-ES',en:'en-GB',fr:'fr-FR'};
// Prefer the authored no-JS fallback (the block holding nf-page). Angular's critical-CSS pass can add an unrelated <noscript> to the head, which must not be replaced.
const AUTHORED_FALLBACK=/<noscript>(?:(?!<\/noscript>)[\s\S])*?nf-page[\s\S]*?<\/noscript>/;
const ANY_NOSCRIPT=/<noscript>[\s\S]*?<\/noscript>/;
const FALLBACK_BLOCK={test:html=>AUTHORED_FALLBACK.test(html)||ANY_NOSCRIPT.test(html),replace:(html,value)=>html.replace(AUTHORED_FALLBACK.test(html)?AUTHORED_FALLBACK:ANY_NOSCRIPT,value)};

/** Fixed, authored document copy only. Never translates page content or user data. */
export function finaliseDocument(html,language,{publicPage=false}={}){
 if(!Object.hasOwn(copy,language)||!Object.hasOwn(LANGUAGE_TAGS,language))throw new Error('Unsupported document language');
 const lang=LANGUAGE_TAGS[language];
 const compiledLanguage=/<html[^>]*lang="([^"]+)"/.exec(html)?.[1];
 if(![lang,language].includes(compiledLanguage))throw new Error('Compiled document locale mismatch');
 html=html.replace(/(<html[^>]*lang=")[^"]+"/,`$1${lang}"`);
 if(!FALLBACK_BLOCK.test(html))throw new Error('Expected the single source noscript fallback');
 if(publicPage)return FALLBACK_BLOCK.replace(html,'');
 const text=copy[language];
 const fallback=`<noscript><link rel="stylesheet" href="/visitor-assets/not-found.v1.css"><div class="nf-page"><header class="nf-header"><a class="nf-brand" href="/${language}/">uvh.</a></header><main class="nf-main"><section class="nf-copy"><h1>${escape(text.heading)}</h1><p class="nf-lead">${escape(text.message)}</p><div class="nf-actions"><a class="nf-button nf-button-primary" href="/${language}/">${escape(text.home)}</a><a class="nf-button" href="/${language}${routes.help[language]}">${escape(text.help)}</a></div></section><img class="nf-fallback" src="/visitor-assets/puzzle-static.v1.svg" width="270" height="270" alt="${escape(text.imageAlt)}"></main></div></noscript>`;
 return FALLBACK_BLOCK.replace(html,fallback)
  .replace(/<title>[\s\S]*?<\/title>/,`<title>${escape(text.title)}</title>`)
  .replace(/<meta\s+(?:name="description"|property="og:(?:title|description)")[^>]*>/g,'')
  .replace('</head>','<meta name="robots" content="noindex, nofollow"></head>');
}

export async function finaliseBuild(outputPath='dist/uvh'){
 const output=pathToFileURL(resolve(fileURLToPath(new URL('..',import.meta.url)),outputPath)+'/');
 const root=new URL('browser/',output);
 let documents=0;
 for(const language of Object.keys(copy)){
  const shell=new URL(`${language}/index.csr.html`,root);
  try{await stat(shell)}catch{continue;}
  await writeFile(shell,finaliseDocument(await readFile(shell,'utf8'),language));documents++;
  for(const translations of Object.values(routes)){
   const page=new URL(`${language}${translations[language].replace(/\/$/,'')}/index.html`,root);
   const original=await readFile(page,'utf8');
   await writeFile(page,finaliseDocument(original,language,{publicPage:true}));documents++;
  }
 }
 if(!documents)throw new Error('No compiled locale documents were found');
 await import('./nginx-localisation.mjs').then(async ({nginxLocalisation})=>{
  const {mkdir}=await import('node:fs/promises');const directory=new URL('nginx/',output);await mkdir(directory,{recursive:true});
  for(const surface of ['app','public'])await writeFile(new URL(surface+'.conf.template',directory),nginxLocalisation(surface));
 });
 console.log(`Finalised ${documents} locale documents; public HTML works without JavaScript.`);
}
if(process.argv[1]===fileURLToPath(import.meta.url))await finaliseBuild();
