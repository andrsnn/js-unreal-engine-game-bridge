import {build} from 'file:///C:/Users/Aidan%20Anderson/karvos/node_modules/vite/dist/node/index.js';
process.chdir('G:/sfx/karvos');
await build({root: process.cwd(), configFile: 'G:/sfx/karvos/scripts/vite-owner-fixes.config.mjs', build: {outDir: 'G:/sfx/karvos/dist-audio-check', emptyOutDir: false, copyPublicDir: false}});
