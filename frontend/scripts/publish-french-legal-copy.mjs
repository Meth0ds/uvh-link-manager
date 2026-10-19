/** Explicit preparation tool. Uses the compiled French copy of the legal pages.
 * Writes copies pending legal review; never runs during builds and never
 * overwrites an existing historical document. */
import {readFile, mkdir, writeFile, rename, rm, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const version = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(version ?? '')) throw new Error('Specify the legal version (YYYY-MM-DD).');
const root = new URL('../', import.meta.url);
const directory = new URL(`public/legal/versions/${version}/fr/`, root);
try { await stat(directory); throw new Error('A published French copy already exists. Publish a new version instead.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const staging = new URL(`public/legal/versions/${version}/.fr-staging/`, root);
const spanish = JSON.parse(await readFile(new URL(`public/legal/versions/${version}/manifest.json`, root), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const clean = html => html.replace(/<!--[^]*?-->/g, '').replace(/\s+(?:_ngcontent-[\w-]+|_nghost-[\w-]+|ngh|ng-reflect-[\w-]+)="[^"]*"/g, '');
const published = {};
await mkdir(staging, {recursive: false});
try {
  for (const [slug, sourceSlug, title, route] of [
    ['terms', 'terminos', 'Conditions de service', 'conditions'],
    ['privacy', 'privacidad', 'Politique de confidentialité', 'confidentialite'],
  ]) {
    const html = await readFile(new URL(`dist/uvh-fr/browser/fr/legal/${route}/index.html`, root), 'utf8');
    if (!/<html[^>]*lang="fr-FR"/.test(html)) throw new Error('Expected a French production build.');
    const sections = [...html.matchAll(/<section[^>]*class="doc-section"[^]*?<\/section>/g)].map(match => clean(match[0]));
    if (sections.length !== 20) throw new Error('Expected all 20 legal clauses.');
    const anchors = sections.map(section => /\bid="([^"]+)"/.exec(section)?.[1]);
    if (JSON.stringify(anchors) !== JSON.stringify(spanish[sourceSlug].anchors)) throw new Error('The translated clauses do not match the source document structure.');
    const contents = sections.map((section, index) => `<li><a href="#${anchors[index]}">${/<h2>([^]*?)<\/h2>/.exec(section)[1]}</a></li>`).join('');
    const document = `<!doctype html><html lang="fr-FR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · Version ${version} · UVH</title><link rel="stylesheet" href="../../archive.css"></head><body><a class="skip-link" href="#document">Aller au document</a><header class="archive-header"><a class="brand" href="/fr/" aria-label="UVH, retour à l’accueil">uvh<span>.</span></a><nav aria-label="Consultation juridique"><a href="/fr/legal/conditions">Conditions actuelles</a><a href="/fr/legal/confidentialite">Confidentialité actuelle</a></nav></header><main id="document" tabindex="-1"><p class="eyebrow">UVH / Document publié</p><h1>${title}</h1><p class="version">Version ${version} · Français</p><aside class="archive-note" aria-label="Copie du document"><p>Cette copie conserve les clauses de la version indiquée. Vous pouvez l’imprimer ou l’enregistrer avec la fonction d’impression de votre navigateur. Les informations de configuration de l’installation sont consultables sur la <a href="/fr/legal/${route}">page du document actuel</a>.</p><p>Ceci est la traduction française du <a href="../${sourceSlug}.html" hreflang="es">document espagnol</a>. Le prestataire, la juridiction et les conditions restent identiques.</p></aside><nav class="contents" aria-label="Sommaire"><h2>Sommaire</h2><ol>${contents}</ol></nav><article>${sections.join('\n')}</article></main></body></html>\n`;
    if (/<script\b|ng-container|i18n=/.test(document)) throw new Error('Historical copies must be static documents.');
    await writeFile(new URL(`${slug}.html`, staging), document);
    published[slug] = {version, language: 'fr-FR', sourceLanguage: 'es-ES', sourceSha256: spanish[sourceSlug].sha256, sha256: digest(document), sections: 20, anchors};
  }
  await writeFile(new URL('manifest.json', staging), JSON.stringify(published, null, 2) + '\n');
  await rename(staging, directory);
  console.log('Wrote immutable French legal copies pending legal review: ' + fileURLToPath(directory));
} catch (error) { await rm(staging, {recursive: true, force: true}); throw error; }
