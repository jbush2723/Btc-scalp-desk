import {createPrivateKey, sign, constants} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export function parsePrivateKey(pem) {
  const key=createPrivateKey(pem);
  if(!['ed25519','rsa','rsa-pss'].includes(key.asymmetricKeyType)) throw Error('Unsupported key type');
  return key;
}
export function authHeaders(keyId,key,path='/trade-api/ws/v2',now=Date.now()) {
  if(!/^[a-zA-Z0-9_-]{8,128}$/.test(keyId)) throw Error('Invalid Key ID');
  const timestamp=String(now), message=Buffer.from(timestamp+'GET'+path.split('?')[0]);
  const signature=key.asymmetricKeyType==='ed25519' ? sign(null,message,key) :
    sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST});
  return {'KALSHI-ACCESS-KEY':keyId,'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':signature.toString('base64')};
}
export async function loadCredentials() {
  let keyId=process.env.KALSHI_KEY_ID, keyPath=process.env.KALSHI_PRIVATE_KEY_PATH;
  if(!keyId||!keyPath){
    let config;
    try{config=JSON.parse(await readFile(new URL('./.local/kalshi.json',import.meta.url),'utf8'));}
    catch(e){if(e.code==='ENOENT')return null;throw Error('Invalid local configuration');}
    ({keyId,keyPath}=config);
  }
  const key=parsePrivateKey(await readFile(keyPath,'utf8'));
  authHeaders(keyId,key);
  return {keyId,key};
}
