import {resolve} from 'node:path';
const project=resolve(import.meta.dir,'../..');
process.chdir(project);
if(!process.argv.includes('--data'))process.argv.push('--data',resolve(project,'.data'));
await import('../web-build');
await import('./main');
