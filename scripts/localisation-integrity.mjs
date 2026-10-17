import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { XmlParser } = await import(require.resolve('@angular/compiler'));
const { Xliff2TranslationParser } = await import(require.resolve('@angular/localize/tools'));

/** Checks structure and approved copy. It never produces translations. */
export function validateLocalisation(source, target, memory) {
  const problems = [];
  const documents = [source, target].map((contents, index) => {
    const document = new XmlParser().parse(contents, index ? 'en-GB.xlf' : 'es.xlf');
    problems.push(...document.errors.map(error => error.toString()));
    const units = new Map();
    function visit(nodes) {
      for (const node of nodes) {
        if (node.name === 'unit') {
          const id = node.attrs.find(attr => attr.name === 'id')?.value;
          if (!id || units.has(id)) problems.push(`Missing or duplicate message id: ${id}`);
          else units.set(id, node);
        }
        if (node.children) visit(node.children);
      }
    }
    visit(document.rootNodes);
    return units;
  });
  const [sourceUnits, targetUnits] = documents;
  function segment(unit, name) {
    const section = unit.children.find(node => node.name === 'segment');
    return section?.children.find(node => node.name === name);
  }
  function tokens(node) {
    const entries = [];
    function visit(nodes) {
      for (const child of nodes) {
        if (child.name) {
          if (!['ph', 'pc', 'sc', 'ec', 'mrk'].includes(child.name)) problems.push(`Unexpected translation markup: ${child.name}`);
          entries.push(child.name + ':' + child.attrs.map(attr => `${attr.name}=${attr.value}`).sort().join(','));
        }
        if (child.children) visit(child.children);
      }
    }
    visit(node?.children ?? []);
    return entries.sort().join('\n');
  }
  for (const [id, unit] of sourceUnits) {
    const original = segment(unit, 'source');
    const translated = segment(targetUnits.get(id) ?? { children: [] }, 'target');
    if (!translated) { problems.push(`Missing target: ${id}`); continue; }
    if (tokens(original) !== tokens(translated)) problems.push(`Placeholder mismatch: ${id}`);
    if (!memory[id]?.text?.trim() || !/^[a-f\d]{64}$/.test(memory[id]?.sourceHash ?? '')) problems.push(`Missing approved copy: ${id}`);
  }
  for (const id of targetUnits.keys()) if (!sourceUnits.has(id)) problems.push(`Unknown target: ${id}`);
  const parser = new Xliff2TranslationParser();
  const analysis = parser.analyze('en-GB.xlf', target);
  if (!analysis.canParse) problems.push(analysis.diagnostics.formatDiagnostics('Invalid English XLIFF'));
  else {
    const parsed = parser.parse('en-GB.xlf', target, analysis.hint);
    if (parsed.locale !== 'en-GB') problems.push('The target language must be en-GB');
    problems.push(...parsed.diagnostics.messages.map(diagnostic => diagnostic.message));
  }
  return problems;
}

export const sourceFingerprint = text => createHash('sha256').update(text).digest('hex');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../frontend/src/locale/', import.meta.url);
  const problems = validateLocalisation(
    readFileSync(new URL('messages.xlf', root), 'utf8'),
    readFileSync(new URL('messages.en-GB.xlf', root), 'utf8'),
    JSON.parse(readFileSync(new URL('translations.en-GB.json', root), 'utf8')),
  );
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('XLIFF structure, ids and translation placeholders are valid.');
}
