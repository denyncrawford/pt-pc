import {test,expect} from 'bun:test';
import {files} from './resources';
// Check the complete browser module graph, including dynamic imports/worklets.
test('every relative browser import is exposed by the host',async()=>{
 for(const [name,resource] of Object.entries(files)){
  expect(await Bun.file(resource.path).exists()).toBe(true);
  if(!name.endsWith('.js'))continue;
  const source=await Bun.file(resource.path).text();
  const imports=[...source.matchAll(/(?:from\s*|import\s*\(\s*|new URL\(\s*)['"]\.\/([^'"]+)['"]/g)];
  for(const match of imports)expect(files[match[1]],`${name} imports unserved ${match[1]}`).toBeDefined();
 }
});
