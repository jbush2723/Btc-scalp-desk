import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {parsePrivateKey,authHeaders} from './kalshi-auth.mjs';

const rl=createInterface({input:stdin,output:stdout});
try{
  console.log('Connect official BRTI. Enter a file location, never paste the private key.');
  const answer=(await rl.question('Key file path (Enter = Downloads/kalshi-key.txt): ')).trim().replace(/^"|"$/g,'');
  const keyPath=answer?resolve(answer):resolve(homedir(),'Downloads','kalshi-key.txt');
  const key=parsePrivateKey(await readFile(keyPath,'utf8'));
  const keyId=(await rl.question('Kalshi Key ID: ')).trim();
  authHeaders(keyId,key);
  const dir=new URL('./.local/',import.meta.url);
  await mkdir(dir,{recursive:true});
  await writeFile(new URL('kalshi.json',dir),JSON.stringify({keyId,keyPath}),{mode:0o600});
  console.log('Saved local connection settings. The original private-key file stays in place. The dashboard will reconnect automatically.');
}catch{console.error('Setup was not saved. Check the file location, complete private-key file and Key ID.');process.exitCode=1;}
finally{rl.close();}
