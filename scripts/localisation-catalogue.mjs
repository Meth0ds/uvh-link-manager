import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'frontend/src/locale/';
const xml = readFileSync(base+'messages.xlf','utf8');
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([a-f\d]+));/gi,(entity,decimal,hex)=>decimal?String.fromCodePoint(Number(decimal)):hex?String.fromCodePoint(parseInt(hex,16)):({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[entity]??entity));
const encode = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const units = [...xml.matchAll(/<unit\s+id="([^"]+)"[\s\S]*?<source>([\s\S]*?)<\/source>[\s\S]*?<\/unit>/g)].map(match=>{
 const tags=[];const source=decode(match[2].replace(/<[^>]+>/g,tag=>{tags.push(tag);return `⟦${tags.length-1}⟧`;}));
 return {id:match[1],source,tags,xml:match[0],locations:[...match[0].matchAll(/<note category="location">([^<]+)<\/note>/g)].map(x=>x[1])};
});
const memoryFile=base+'translations.en-GB.json';
let memory=existsSync(memoryFile)?JSON.parse(readFileSync(memoryFile,'utf8')):{};
const command=process.argv[2]??'status';
if(command==='next'){
 const pending=units.filter(u=>memory[u.id]?.sourceHash!==createHash('sha256').update(u.source).digest('hex')).slice(0,Number(process.argv[3]??100));
 writeFileSync('.planning/bilingual/current-translation-batch.json',JSON.stringify(pending.map(u=>({id:u.id,source:u.source})),null,2)+'\n');
 console.log(pending.map((u,i)=>i+'\t'+u.source.replaceAll('\n','\\n')).join('\n'));
} else if(command==='apply-next') {
 const pending=JSON.parse(readFileSync('.planning/bilingual/current-translation-batch.json','utf8'));
 const lines=readFileSync(process.argv[3],'utf8').trimEnd().split('\n');
 if(lines.length!==pending.length)throw new Error(`Expected ${pending.length} translations, got ${lines.length}`);
 const batch={};pending.forEach((p,i)=>{const actual=units.find(u=>u.id===p.id);if(!actual||actual.source!==p.source)throw new Error('Source changed '+p.id);batch[p.id]=lines[i];});
 writeFileSync('.planning/bilingual/range-batch.json',JSON.stringify(batch,null,2)+'\n');
 console.log('Prepared '+lines.length+' authored translations');
} else if(command==='apply-range'){
 const start=Number(process.argv[3]), lines=readFileSync(process.argv[4],'utf8').trimEnd().split('\n');
 const batch={};lines.forEach((text,index)=>{const unit=units[start+index];if(!unit)throw new Error('Invalid range');batch[unit.id]=text;});
 writeFileSync('.planning/bilingual/range-batch.json',JSON.stringify(batch,null,2)+'\n');
 console.log('Prepared '+lines.length+' translations; run apply on .planning/bilingual/range-batch.json');
} else if(command==='list'){
 const start=Number(process.argv[3]??0),count=Number(process.argv[4]??100);
 console.log(units.slice(start,start+count).map((u,i)=>`${start+i}\t${u.id}\t${u.source.replaceAll('\n','\\n')}`).join('\n'));
} else if(command==='apply') {
 const batch=JSON.parse(readFileSync(process.argv[3],'utf8'));
 for(const [id,translation] of Object.entries(batch)){
  const unit=units.find(u=>u.id===id);if(!unit)throw new Error('Unknown message '+id);
  if(typeof translation!=='string'||!translation.trim())throw new Error('Empty translation '+id);
  const expected=[...unit.source.matchAll(/⟦\d+⟧/g)].map(x=>x[0]).sort();const actual=[...translation.matchAll(/⟦\d+⟧/g)].map(x=>x[0]).sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('Placeholder mismatch '+id);
  memory[id]={sourceHash:createHash('sha256').update(unit.source).digest('hex'),text:translation};
 }
 writeFileSync(memoryFile,JSON.stringify(memory,null,2)+'\n');
} else if(command==='generate'||command==='check'||command==='status') {
 const translated=units.filter(u=>memory[u.id]?.sourceHash===createHash('sha256').update(u.source).digest('hex'));
 const missing=units.filter(u=>!translated.includes(u));
 console.log(JSON.stringify({messages:units.length,translated:translated.length,missing:missing.length}));
 if(command==='check'&&missing.length){console.error(missing.slice(0,15).map(u=>u.id+': '+u.source.slice(0,100)).join('\n'));process.exitCode=1;}
 if(command==='generate'||command==='check'){
  let output=xml.replace(/srcLang="(?:es|es-ES)"/,'srcLang="es" trgLang="en-GB"');
  for(const unit of translated){const value=memory[unit.id];const text=(/^\s/.test(unit.source)&&!/^\s/.test(value.text)?' ':'')+value.text+(/\s$/.test(unit.source)&&!/\s$/.test(value.text)?' ':'');const target=encode(text).replace(/⟦(\d+)⟧/g,(_,i)=>unit.tags[Number(i)]);output=output.replace(unit.xml,unit.xml.replace('</source>','</source>\n        <target>'+target+'</target>'));}
  if(command==='generate') writeFileSync(base+'messages.en-GB.xlf',output);
  else if(readFileSync(base+'messages.en-GB.xlf','utf8')!==output) { console.error('English XLIFF differs from the approved translation memory. Run i18n:generate.'); process.exitCode=1; }
 }
} else throw new Error('Unknown command');
