import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const client=join(import.meta.dir,'client'),output=join(client,'dist');
await mkdir(output,{recursive:true});
const compiler=new Bun.Transpiler({loader:'ts',target:'browser'});
for(const name of await readdir(client)){
 if(!name.endsWith('.ts')||name.endsWith('.d.ts'))continue;
 await writeFile(join(output,name.replace(/\.ts$/,'.js')),compiler.transformSync(await readFile(join(client,name),'utf8')));
}
console.log('Browser modules built.');
