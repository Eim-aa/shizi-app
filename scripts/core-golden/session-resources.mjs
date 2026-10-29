#!/usr/bin/env node
// Generated UI dictionaries/constants from real JS exports. No duplicated product literals.
import fs from 'node:fs';
import { listOps } from '../../src/session/api/index.js';
import { HINT_DRAW } from '../../src/session/ops/hint.js';
import { backupView } from '../../src/core/backup.js';
import * as w from '../../src/session/write-api.js';
const result={apiOps:listOps().filter(op=>!op.startsWith("nav.")&&!op.startsWith("route.")&&!op.startsWith("tabs.")&&!op.startsWith("deeplink.")),hintDraw:HINT_DRAW,backupTemplate:backupView({records:{}}),writeKeys:w.NATIVE_WRITE_COPY_KEYS,resultKeys:w.NATIVE_RESULT_COPY_KEYS,timing:w.writeTiming(),motion:w.writeMotion(),layout:w.writeLayoutConstants(),trace:w.writeTrace(),skipUndo:w.writeSkipUndo(),ink:w.writeInk(),resultMotion:w.resultMotion()};
const path=new URL('../../ios/ShiziCore/Sources/ShiziCore/Session/SessionBundled/session-ui.json',import.meta.url);
const text=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--check')) {if(!fs.existsSync(path)||fs.readFileSync(path,'utf8')!==text)throw new Error('session-ui.json out of date');}
else fs.writeFileSync(path,text);
