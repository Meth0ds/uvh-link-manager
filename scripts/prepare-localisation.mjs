// Migration helper: Angular/TypeScript ASTs identify presentation text; never run as part of a build.
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import { parseTemplate } from '../frontend/node_modules/@angular/compiler/fesm2022/compiler.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const write = process.argv.includes('--write');
const spanish = /[áéíóúñ¿¡]|\b(?:enlaces?|crear|guardar|eliminar|nombre|contraseña|cancelar|espacio|selecciona|destino|No se|debe|Sin |Volver|puede|puedes|disponibles?|correo|sesión|copiar|cuenta|activo|visitas|Error del|Cargando|equipo|seguridad|Comprueba|Permite|Texto|Todos|dominios?|Reintentar|Reintenta|Revisa|Revisar|Solicitar|Solicita|Ver |Nueva|nuevo|nueva|Formato|Faltan|falta|Mensaje|Hoy|Ayer|Enviar|Cerrar|Anterior|Siguiente|Pendiente|Etiquetas|Buscar|Compartir|Aceptar|Abrir|Idioma|Ayuda|Inicio|Detalles|Borrar|Desactivar|Activar|Restaurar|Comprobar|Descargar|imprimir|Impresión|Opcional|Avanzado|Acceso|Resumen|Notas|Estado|Sincronizar|Cambiar)\b/i;
const fixed = new Set(['RECUPERAR MI CUENTA', 'ELIMINAR MI CUENTA']);
const visible = value => typeof value === 'string' && value.length < 1600 && !fixed.has(value) && !/^\s*(?:\/|https?:|[.#][\w-]+\{|<)/.test(value) && !/[{}].*[:;]/s.test(value) && spanish.test(value);
const id = text => 'ui.' + createHash('sha256').update(text).digest('hex').slice(0,14);
const patches = (text, edits) => { for (const e of edits.sort((a,b)=>b.start-a.start || b.end-a.end)) text = text.slice(0,e.start)+e.value+text.slice(e.end);return text; };
const inventory = [];
const dynamic = new Map();
function template(source, file) {
  const parsed = parseTemplate(source, file, {preserveWhitespaces:true});
  if (parsed.errors?.length) throw new Error(`${file}: ${parsed.errors.map(e=>e.msg).join('; ')}`);
  const edits=[], seen=new Set();let usesText=false;
  const expression = value => {
    if (!value || typeof value!=='object' || seen.has(value)) return;
    seen.add(value);
    if (value.constructor.name==='LiteralPrimitive' && visible(value.value)) {
      const span=value.sourceSpan;
      if(span && /['"]/.test(source[span.start]) && source.slice(span.start,span.end).length===value.value.length+2) {
        const key=id(value.value).replace('.','_');dynamic.set(key,value.value);usesText=true;
        edits.push({start:span.start,end:span.end,value:`uiText.${key}`});inventory.push({file,kind:'template-expression',id:id(value.value),source:value.value});
      }
      return;
    }
    for(const [key,child] of Object.entries(value)) if(!['sourceSpan','span','source','location','errors'].includes(key)) {
      if(Array.isArray(child))child.forEach(expression);else expression(child);
    }
  };
  const visit=(node,excluded=false,insideI18n=false)=>{
    if(!node||typeof node!=='object')return;
    const tag=node.name;
    const skip=excluded||['mat-icon','code','pre','script','style','textarea','svg','path'].includes(tag);
    const annotated=insideI18n||!!node.i18n||node.attributes?.some(a=>a.name==='i18n');
    if(!skip && ['Text','BoundText'].includes(node.constructor.name) && !annotated){
      const start=node.sourceSpan.start.offset,end=node.sourceSpan.end.offset,raw=source.slice(start,end);
      const literal=raw.replace(/{{[\s\S]*?}}/g,'').trim();
      if(/[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡]/.test(literal) && !/^https?:|^[\w.-]+\.(es|com|test|org)(?:\/|$)/.test(literal)) {
        edits.push({start,end:start,value:`<ng-container i18n="@@${id(raw)}">`},{start:end,end,value:'</ng-container>'});inventory.push({file,kind:'template-text',id:id(raw),source:raw.trim()});
      }
    }
    if(!skip){
      for(const attr of node.attributes??[]) if(['title','placeholder','aria-label','alt','matTooltip'].includes(attr.name) && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(attr.value) && !node.attributes.some(a=>a.name==='i18n-'+attr.name)){
        const at=node.startSourceSpan.end.offset-(node.isSelfClosing?2:1);
        edits.push({start:at,end:at,value:` i18n-${attr.name}="@@${id(attr.value)}"`});inventory.push({file,kind:'attribute',id:id(attr.value),source:attr.value});
      }
      expression(node.value);for(const input of node.inputs??[])expression(input.value);for(const output of node.outputs??[])expression(output.handler);
    }
    for(const child of node.children??[])visit(child,skip,annotated);
    for(const branch of node.branches??[]) {expression(branch.expression);visit(branch,skip,annotated);}
    if(node.empty)visit(node.empty,skip,annotated);
    for(const block of node.cases??[])visit(block,skip,annotated);
  };
  parsed.nodes.forEach(n=>visit(n));
  return {text:patches(source,edits),usesText};
}
const files=[];function walk(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+f.name;if(f.isDirectory())walk(p);else if((p.endsWith('.html')||p.endsWith('.ts'))&&!p.endsWith('.spec.ts')&&!p.endsWith('.d.ts'))files.push(p)}}walk('frontend/src/app');
for(const file of files){
  let source=readFileSync(file,'utf8'), usesText=false;
  if(file.endsWith('.html')) { const result=template(source,file);source=result.text;usesText=result.usesText; }
  else {
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const edits=[];
    function visit(node){
      if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='template'&&(ts.isStringLiteral(node.initializer)||ts.isNoSubstitutionTemplateLiteral(node.initializer))){
        const init=node.initializer,result=template(source.slice(init.getStart(ast)+1,init.end-1),file);usesText ||= result.usesText;
        edits.push({start:init.getStart(ast)+1,end:init.end-1,value:result.text});return;
      }
      if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateExpression(node))&&visible(ts.isTemplateExpression(node)?node.getText(ast):node.text)){
        const parent=node.parent;
        const skip=ts.isLiteralTypeNode(parent)||ts.isImportDeclaration(parent)||ts.isExportDeclaration(parent)||ts.isImportSpecifier(parent)||ts.isImportClause(parent)||ts.isElementAccessExpression(parent)||ts.isCaseClause(parent)||ts.isBinaryExpression(parent)&&['===','!==','==','!='].includes(parent.operatorToken.getText(ast))||ts.isTaggedTemplateExpression(parent)||ts.isPropertyAssignment(parent)&&parent.name===node;
        if(!skip){const raw=node.getText(ast),text=ts.isTemplateExpression(node)?raw.slice(1,-1):node.text;
          if(!text.includes('\n')&&!text.includes('<')&&!/^(?:es|en)(?:-|_)|^\^|^\\/.test(text)){
            const content=ts.isTemplateExpression(node)?raw.slice(1,-1):text.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${');
            edits.push({start:node.getStart(ast),end:node.end,value:'$localize`:'+ '@@'+id(text)+':'+content+'`'});inventory.push({file,kind:'typescript',id:id(text),source:text});return;
          }
        }
      }
      ts.forEachChild(node,visit);
    }visit(ast);source=patches(source,edits);
  }
  if(write)writeFileSync(file,source);
  if(usesText) inventory.push({file,kind:'requires-UI_TEXT'});
}
writeFileSync('.planning/bilingual/source-inventory.json',JSON.stringify(inventory,null,2)+'\n');
if(write){
  const values=[...dynamic].map(([key,text])=>`  ${key}: $localize\`:@@${id(text)}:${text.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${')}\`,`).join('\n');
  writeFileSync('frontend/src/app/core/localisation/template-messages.ts',`// Shared presentation phrases used by Angular template expressions.\nexport const UI_TEXT = {\n${values}\n} as const;\n`);
  const needs=new Set(inventory.filter(i=>i.kind==='requires-UI_TEXT').map(i=>i.file.endsWith('.html')?i.file.replace(/\.html$/,'.ts'):i.file));
  for(const file of needs){let source=readFileSync(file,'utf8');let relative=await import('node:path').then(p=>p.relative(p.dirname(file),'frontend/src/app/core/localisation/template-messages').replaceAll('\\','/'));if(!relative.startsWith('.'))relative='./'+relative;
    source=`import { UI_TEXT } from ${JSON.stringify(relative)};\n`+source;source=source.replace(/(export class \w+[^\{]*\{)/,'$1\n  readonly uiText = UI_TEXT;');writeFileSync(file,source);
  }
}
console.log(JSON.stringify({references:inventory.length,unique:new Set(inventory.filter(x=>x.id).map(x=>x.id)).size,templateExpressions:dynamic.size,files:files.length,write}));
