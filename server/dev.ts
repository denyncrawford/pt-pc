import {resolve} from 'node:path';
const project=resolve(import.meta.dir,'..');
process.chdir(project);
process.argv.push('--data',resolve(project,'.data'));
await import('./main');
