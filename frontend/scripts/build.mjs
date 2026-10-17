import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {finaliseBuild} from './finalise-localisation.mjs';

const args=process.argv.slice(2);
const option=(long,short)=>{
 const prefix=`--${long}=`;
 const inline=args.find(value=>value.startsWith(prefix));
 if(inline)return inline.slice(prefix.length);
 const index=args.findIndex(value=>value===`--${long}`||value===short);
 return index<0?undefined:args[index+1];
};
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js',import.meta.url)),'build',...args],{stdio:'inherit'});
const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(signal?1:code??1));});
if(status!==0)process.exit(status);
if(!(option('configuration','-c')??'').split(',').includes('design-preview'))await finaliseBuild(option('output-path'));
