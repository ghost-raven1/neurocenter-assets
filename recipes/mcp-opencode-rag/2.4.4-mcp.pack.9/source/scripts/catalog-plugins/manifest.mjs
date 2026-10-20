import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import path from 'node:path';
import {validateAsset,toToolPublication} from '@neurocenter/asset-contract';

const require=createRequire(new URL('../../services/catalog-service/package.json',import.meta.url));
const {normalizeRuntimeArtifacts,inspectRuntimeArchive}=require('../shared/runtime-artifacts.cjs');

/** Повтор одной source версии всегда использует тот же native publication intent. */
export function publicationKey(key,version){
    const bytes=createHash('sha256').update(`neurocenter-source-asset\0${key}\0${version}`).digest().subarray(0,16);
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/** Локальный snapshot читается ограниченно и проверяется до любого административного IO. */
async function readSourceSnapshot(directory,source){
    if(source.type!=='archive')return;
    if(source.bytes>16*1024*1024)throw new Error('Source snapshot превышает 16 МиБ.');
    const filename=path.join(directory,'source-snapshot.json'),handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size!==source.bytes)throw new Error('Source snapshot type/bytes не совпали.');
        const bytes=await handle.readFile(),after=await handle.stat(),named=await lstat(filename);
        if(bytes.length!==source.bytes||createHash('sha256').update(bytes).digest('hex')!==source.sha256||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==named.ino||before.dev!==named.dev||named.isSymbolicLink())throw new Error('Source snapshot SHA/bytes изменились.');
        return bytes;
    }finally{await handle.close();}
}

/** Старый ready/tools manifest не принимается; файл содержит ровно один source envelope. */
export async function readyManifest(filename){
    const absolute=path.resolve(filename),handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    let asset;
    try{const info=await handle.stat();if(!info.isFile()||info.nlink!==1||info.size<1||info.size>16*1024*1024)throw new Error('Нужен обычный asset.json до 16 МиБ.');const bytes=await handle.readFile(),after=await handle.stat();if(bytes.length!==info.size||after.mtimeMs!==info.mtimeMs)throw new Error('Asset изменился при чтении.');asset=validateAsset(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}
    finally{await handle.close();}
    if(!['mcp','plugin'].includes(asset.kind))throw new Error('Нужен MCP/plugin source asset.');
    const sourceSnapshot=await readSourceSnapshot(path.dirname(absolute),asset.source);
    const {validatePublication}=require('./dist/publication/publication-validation.js');
    const {assertLocalUiInventory}=require('./dist/publication/publication-runtime.js');
    const publication=validatePublication(toToolPublication(asset)),artifacts=[];
    for(const supplied of asset.delivery.artifacts){
        const [descriptor]=normalizeRuntimeArtifacts([supplied.descriptor]);
        const archivePath=path.join(path.dirname(absolute),descriptor.sha256+'.tar.gz');
        const entries=await inspectRuntimeArchive(archivePath,descriptor);assertLocalUiInventory(publication.config,publication.kind,entries);
        artifacts.push({archivePath,descriptor});
    }
    return [{asset,key:asset.id,publication:{...publication,publicationKey:publicationKey(asset.id,asset.version)},artifacts,...(sourceSnapshot?{sourceSnapshot}:{})}];
}
