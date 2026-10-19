// Authored translation memory per locale. Never translates: it extracts the
// Spanish source, applies text written by a person and validates placeholders.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'frontend/src/locale/';
const args = process.argv.slice(2);
const options = {};
const positionals = [];
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (!value.startsWith('--')) { positionals.push(value); continue; }
  const [key, inline] = value.slice(2).split('=');
  if (inline !== undefined) options[key] = inline;
  else if (key === 'draft' || args[index + 1]?.startsWith('--') || args[index + 1] === undefined) options[key] = true;
  else options[key] = args[++index];
}
const command = positionals[0] ?? 'status';
const locale = String(options.locale ?? 'en-GB');
if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) throw new Error(`Unsafe locale tag: ${locale}`);
const draft = options.draft === true || options.draft === 'true';
const limit = Number(options.limit ?? 100);
const group = { 'en-GB': 'bilingual', fr: 'french' }[locale] ?? locale.toLowerCase();
const workspace = `.planning/${group}/`;

const xml = readFileSync(base + 'messages.xlf', 'utf8');
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([a-f\d]+));/gi,(entity,decimal,hex)=>decimal?String.fromCodePoint(Number(decimal)):hex?String.fromCodePoint(parseInt(hex,16)):({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[entity]??entity));
const encode = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const units = [...xml.matchAll(/<unit\s+id="([^"]+)"[\s\S]*?<source>([\s\S]*?)<\/source>[\s\S]*?<\/unit>/g)].map(match=>{
  const tags = []; const source = decode(match[2].replace(/<[^>]+>/g, tag => { tags.push(tag); return `⟦${tags.length - 1}⟧`; }));
  return {id: match[1], source, tags, xml: match[0]};
});
const digest = text => createHash('sha256').update(text).digest('hex');
const memoryFile = `${base}translations.${locale}.json`;
const memory = existsSync(memoryFile) ? JSON.parse(readFileSync(memoryFile, 'utf8')) : {};
const approved = unit => memory[unit.id]?.sourceHash === digest(unit.source);
const translated = units.filter(approved);
const missing = units.filter(unit => !approved(unit));
const batchFile = workspace + 'current-translation-batch.json';
const rangeFile = workspace + 'range-batch.json';

const writeBatch = (pending, file) => {
  mkdirSync(workspace, {recursive: true});
  writeFileSync(file, JSON.stringify(pending.map(unit => ({id: unit.id, source: unit.source})), null, 2) + '\n');
};

if (command === 'next') {
  const pending = missing.slice(0, limit);
  writeBatch(pending, batchFile);
  console.log(pending.map((unit, index) => `${index}\t${unit.source.replaceAll('\n', '\\n')}`).join('\n'));
} else if (command === 'apply-next') {
  const pending = JSON.parse(readFileSync(batchFile, 'utf8'));
  const file = positionals[1] ?? options.file;
  if (!file) throw new Error('Specify the file with the authored translations.');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  if (lines.length !== pending.length) throw new Error(`Expected ${pending.length} translations, got ${lines.length}`);
  const batch = {};
  pending.forEach((entry, index) => {
    const actual = units.find(unit => unit.id === entry.id);
    if (!actual || actual.source !== entry.source) throw new Error('Source changed ' + entry.id);
    batch[entry.id] = lines[index];
  });
  mkdirSync(workspace, {recursive: true});
  writeFileSync(rangeFile, JSON.stringify(batch, null, 2) + '\n');
  console.log(`Prepared ${lines.length} authored ${locale} translations`);
} else if (command === 'apply-range') {
  const start = Number(positionals[1] ?? 0);
  const file = positionals[2] ?? options.file;
  if (!file) throw new Error('Specify the file with the authored translations.');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  const batch = {};
  lines.forEach((text, index) => {
    const unit = units[start + index];
    if (!unit) throw new Error('Invalid range');
    batch[unit.id] = text;
  });
  mkdirSync(workspace, {recursive: true});
  writeFileSync(rangeFile, JSON.stringify(batch, null, 2) + '\n');
  console.log(`Prepared ${lines.length} ${locale} translations; apply ${rangeFile}`);
} else if (command === 'list') {
  const start = Number(positionals[1] ?? 0), count = Number(positionals[2] ?? 100);
  console.log(units.slice(start, start + count).map((unit, index) => `${start + index}\t${unit.id}\t${unit.source.replaceAll('\n', '\\n')}`).join('\n'));
} else if (command === 'apply') {
  const file = positionals[1] ?? options.file;
  if (!file) throw new Error('Specify the batch file to apply.');
  const batch = JSON.parse(readFileSync(file, 'utf8'));
  for (const [id, translation] of Object.entries(batch)) {
    const unit = units.find(candidate => candidate.id === id);
    if (!unit) throw new Error('Unknown message ' + id);
    if (typeof translation !== 'string' || !translation.trim()) throw new Error('Empty translation ' + id);
    const expected = [...unit.source.matchAll(/⟦\d+⟧/g)].map(match => match[0]).sort();
    const actual = [...translation.matchAll(/⟦\d+⟧/g)].map(match => match[0]).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Placeholder mismatch ' + id);
    memory[id] = {sourceHash: digest(unit.source), text: translation};
  }
  writeFileSync(memoryFile, JSON.stringify(memory, null, 2) + '\n');
} else if (command === 'generate' || command === 'check' || command === 'status') {
  console.log(JSON.stringify({locale, messages: units.length, translated: translated.length, missing: missing.length, draft}));
  if (command === 'check' && missing.length && !draft) {
    console.error(missing.slice(0, 15).map(unit => unit.id + ': ' + unit.source.slice(0, 100)).join('\n'));
    console.error(`${missing.length} ${locale} messages are awaiting authored copy. Finish them, or use --draft while the locale is still being written.`);
    process.exitCode = 1;
  }
  if (command === 'generate' || command === 'check') {
    const sourceTag = /srcLang="(?:es|es-ES)"/.test(xml) ? 'srcLang="es"' : null;
    if (!sourceTag) throw new Error('The extracted catalogue must declare srcLang="es".');
    let output = xml.replace(/srcLang="(?:es|es-ES)"(?: trgLang="[^"]*")?/, `${sourceTag} trgLang="${locale}"`);
    for (const unit of translated) {
      const value = memory[unit.id];
      const text = (/^\s/.test(unit.source) && !/^\s/.test(value.text) ? ' ' : '') + value.text + (/\s$/.test(unit.source) && !/\s$/.test(value.text) ? ' ' : '');
      const target = encode(text).replace(/⟦(\d+)⟧/g, (_, index) => unit.tags[Number(index)]);
      output = output.replace(unit.xml, unit.xml.replace('</source>', '</source>\n        <target>' + target + '</target>'));
    }
    const outputFile = `${base}messages.${locale}.xlf`;
    if (command === 'generate') writeFileSync(outputFile, output);
    else if (!existsSync(outputFile)) {
      console.error(`${outputFile} is missing. Run the generate command for ${locale}.`);
      process.exitCode = 1;
    } else if (readFileSync(outputFile, 'utf8') !== output) {
      console.error(`${outputFile} differs from the approved ${locale} translation memory. Run the generate command.`);
      process.exitCode = 1;
    }
  }
} else throw new Error('Unknown command: ' + command);
