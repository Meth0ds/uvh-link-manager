/** Explicit publication tool. Uses the reviewed, natively compiled British English copy.
 * Never runs during builds and never overwrites an existing historical document. */
import {readFile,mkdir,writeFile,rename,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const version=process.argv[2];
if(!/^\d{4}-\d{2}-\d{2}$/.test(version??''))throw new Error('Specify the legal version (YYYY-MM-DD).');
const root=new URL('../',import.meta.url);
const directory=new URL(`public/legal/versions/${version}/en/`,root);
try{await stat(directory);throw new Error('A published English copy already exists. Publish a new version instead.');}catch(error){if(error.code!=='ENOENT')throw error;}
const staging=new URL(`public/legal/versions/${version}/.en-staging/`,root);
const spanish=JSON.parse(await readFile(new URL(`public/legal/versions/${version}/manifest.json`,root),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
const clean=html=>html.replace(/<!--[^]*?-->/g,'').replace(/\s+(?:_ngcontent-[\w-]+|_nghost-[\w-]+|ngh|ng-reflect-[\w-]+)="[^"]*"/g,'');
const published={};
await mkdir(staging,{recursive:false});
try{
 for(const [slug,sourceSlug,title]of [['terms','terminos','Terms of service'],['privacy','privacidad','Privacy policy']]){
  const html=await readFile(new URL(`dist/uvh/browser/en/legal/${slug}/index.html`,root),'utf8');
  if(!/<html[^>]*lang="en-GB"/.test(html))throw new Error('Expected a British English production build.');
  const sections=[...html.matchAll(/<section[^>]*class="doc-section"[^]*?<\/section>/g)].map(match=>clean(match[0]));
  if(sections.length!==20)throw new Error('Expected all 20 legal clauses.');
  const anchors=sections.map(section=>/\bid="([^"]+)"/.exec(section)?.[1]);
  if(JSON.stringify(anchors)!==JSON.stringify(spanish[sourceSlug].anchors))throw new Error('The translated clauses do not match the source document structure.');
  const contents=sections.map((section,index)=>`<li><a href="#${anchors[index]}">${/<h2>([^]*?)<\/h2>/.exec(section)[1]}</a></li>`).join('');
  const document=`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · Version ${version} · UVH</title><link rel="stylesheet" href="../../archive.css"></head><body><a class="skip-link" href="#document">Skip to document</a><header class="archive-header"><a class="brand" href="/en/" aria-label="UVH, home">uvh<span>.</span></a><nav aria-label="Legal documents"><a href="/en/legal/terms">Current terms</a><a href="/en/legal/privacy">Current privacy policy</a></nav></header><main id="document" tabindex="-1"><p class="eyebrow">UVH / Published document</p><h1>${title}</h1><p class="version">Version ${version} · British English</p><aside class="archive-note" aria-label="Document copy"><p>This copy preserves the clauses of the stated version. You can print or save it using your browser’s print function. Details of this installation are shown on the <a href="/en/legal/${slug}">current document page</a>.</p><p>This is the English translation of the <a href="../${sourceSlug}.html" hreflang="es">Spanish document</a>. The service provider, jurisdiction and conditions remain the same.</p></aside><nav class="contents" aria-label="Contents"><h2>Contents</h2><ol>${contents}</ol></nav><article>${sections.join('\n')}</article></main></body></html>\n`;
  if(/<script\b|ng-container|i18n=/.test(document))throw new Error('Historical copies must be static documents.');
  await writeFile(new URL(`${slug}.html`,staging),document);
  published[slug]={version,language:'en-GB',sourceLanguage:'es-ES',sourceSha256:spanish[sourceSlug].sha256,sha256:digest(document),sections:20,anchors};
 }
 await writeFile(new URL('manifest.json',staging),JSON.stringify(published,null,2)+'\n');
 await rename(staging,directory);
 console.log('Published immutable English legal copies: '+fileURLToPath(directory));
}catch(error){await rm(staging,{recursive:true,force:true});throw error;}
