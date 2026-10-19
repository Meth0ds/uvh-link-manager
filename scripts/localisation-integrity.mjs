import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { XmlParser } = await import(require.resolve('@angular/compiler'));
const { Xliff2TranslationParser } = await import(require.resolve('@angular/localize/tools'));

/**
 * Checks structure, placeholders and approved copy for one target locale.
 *
 * `allowMissing` exists only for a locale whose catalogue is still being
 * authored: a missing target is reported as pending, not as a structural
 * defect. Placeholder mismatches, unexpected markup and unknown ids always
 * fail, so a draft locale cannot hide a broken translation.
 */
export function validateLocalisation(source, target, memory, { locale = 'en-GB', allowMissing = false } = {}) {
  const problems = [];
  const documents = [source, target].map((contents, index) => {
    const document = new XmlParser().parse(contents, index ? `${locale}.xlf` : 'es.xlf');
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
    if (!translated) {
      if (!allowMissing) problems.push(`Missing target: ${id}`);
      continue;
    }
    if (tokens(original) !== tokens(translated)) problems.push(`Placeholder mismatch: ${id}`);
    if (!memory[id]?.text?.trim() || !/^[a-f\d]{64}$/.test(memory[id]?.sourceHash ?? '')) problems.push(`Missing approved copy: ${id}`);
  }
  for (const id of targetUnits.keys()) if (!sourceUnits.has(id)) problems.push(`Unknown target: ${id}`);
  const parser = new Xliff2TranslationParser();
  const analysis = parser.analyze(`${locale}.xlf`, target);
  if (!analysis.canParse) problems.push(analysis.diagnostics.formatDiagnostics(`Invalid ${locale} XLIFF`));
  else {
    const parsed = parser.parse(`${locale}.xlf`, target, analysis.hint);
    if (parsed.locale !== locale) problems.push(`The target language must be ${locale}`);
    // Angular reports a missing <target> as a parser warning. A draft locale
    // has no targets yet, so that one warning is expected; every other
    // diagnostic (including malformed markup) still fails the check.
    problems.push(...parsed.diagnostics.messages
      .filter(diagnostic => !(allowMissing && /^Missing <target> element/.test(diagnostic.message)))
      .map(diagnostic => diagnostic.message));
  }
  return problems;
}

export const sourceFingerprint = text => createHash('sha256').update(text).digest('hex');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { readFileSync, existsSync } = await import('node:fs');
  const args = process.argv.slice(2);
  const option = name => {
    const inline = args.find(value => value.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = args.indexOf(`--${name}`);
    return index < 0 ? undefined : args[index + 1];
  };
  const locale = option('locale') ?? 'en-GB';
  const allowMissing = args.includes('--draft');
  const root = new URL('../frontend/src/locale/', import.meta.url);
  const targetFile = new URL(`messages.${locale}.xlf`, root);
  if (!existsSync(targetFile)) {
    console.error(`Missing ${targetFile.pathname}. Run the catalogue generate command for ${locale}.`);
    process.exitCode = 1;
  } else {
    const memoryFile = new URL(`translations.${locale}.json`, root);
    const problems = validateLocalisation(
      readFileSync(new URL('messages.xlf', root), 'utf8'),
      readFileSync(targetFile, 'utf8'),
      existsSync(memoryFile) ? JSON.parse(readFileSync(memoryFile, 'utf8')) : {},
      { locale, allowMissing },
    );
    if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
    else console.log(`${locale}: XLIFF structure, ids and translation placeholders are valid${allowMissing ? ' (draft: pending copy allowed)' : ''}.`);
  }
}
