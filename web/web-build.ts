import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const client=join(import.meta.dir,'client'),output=join(client,'dist');
await mkdir(output,{recursive:true});
const compiler=new Bun.Transpiler({loader:'ts',target:'browser'});
for(const name of await readdir(client)){
 if(!name.endsWith('.ts')||name.endsWith('.d.ts')||name==='launcher.ts')continue;
 await writeFile(join(output,name.replace(/\.ts$/,'.js')),compiler.transformSync(await readFile(join(client,name),'utf8')));
}
// Bundle React locally. Keep the game lazy and its WASM/worklet URLs stable.
const result=await Bun.build({entrypoints:[join(client,'launcher.ts')],outdir:output,target:'browser',plugins:[{name:'runtime-boundary',setup(build){build.onResolve({filter:/^\.\/(app|remote)\.js$/},({path})=>({path,external:true}));}}],naming:'[name].js',minify:true});
if(!result.success)throw new AggregateError(result.logs,'React build failed');
console.log('Browser modules and React UI built.');
