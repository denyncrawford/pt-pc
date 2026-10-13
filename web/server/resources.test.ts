import {test,expect} from 'bun:test';
import ts from 'typescript';
import {files} from './resources';
// Parse syntax, not diagnostic strings inside bundled React or other dependencies.
test('every relative browser import is exposed by the host',async()=>{
 for(const [name,resource] of Object.entries(files)){
  expect(await Bun.file(resource.path).exists()).toBe(true);
  if(!name.endsWith('.js'))continue;
  const tree=ts.createSourceFile(name,await Bun.file(resource.path).text(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  function visit(node:ts.Node){
   let target:ts.Expression|undefined;
   if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))target=node.moduleSpecifier;
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)target=node.arguments[0];
   if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL')target=node.arguments?.[0];
   if(target&&ts.isStringLiteral(target)&&target.text.startsWith('./'))expect(files[target.text.slice(2)],`${name} imports unserved ${target.text}`).toBeDefined();
   ts.forEachChild(node,visit);
  }
  visit(tree);
 }
});
