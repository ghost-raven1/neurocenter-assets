import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRepository,assetDigest,assertIndexEvolution,toToolPublication} from '../lib/index.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const audit=JSON.parse(await fs.readFile(path.join(root,'audit/python-context-2026-10-20.json'),'utf8'));

test('Python context addition preserves every previously published source identity and descriptor SHA',async()=>{
 const loaded=await loadRepository(root);assertIndexEvolution(audit.previousIndex.value,loaded.index);
 assert.equal(audit.previousIndex.value.assets.length,26);
 for(const previous of audit.previousIndex.value.assets){const current=loaded.index.assets.find(item=>item.id===previous.id&&item.version===previous.version);assert.ok(current);assert.equal(current.sha256,previous.sha256);assert.equal(current.path,previous.path);assert.equal(assetDigest(await fs.readFile(path.join(root,current.path))),previous.sha256);}
 const tampered=structuredClone(loaded.index);tampered.assets.find(item=>item.id===audit.previousIndex.value.assets[0].id).sha256='f'.repeat(64);assert.throws(()=>assertIndexEvolution(audit.previousIndex.value,tampered),/bytes/);
 const removed=structuredClone(loaded.index);removed.assets=removed.assets.filter(item=>!(item.id===audit.previousIndex.value.assets[0].id&&item.version===audit.previousIndex.value.assets[0].version));assert.throws(()=>assertIndexEvolution(audit.previousIndex.value,removed),/disappear/);
});

test('Python context retains exact public TypeScript source and checked archive snapshot without deployment metadata',async()=>{
 const loaded=await loadRepository(root),record=loaded.assets.find(item=>item.asset.id==='plugin-python-context'&&item.asset.version==='1.0.0');assert.ok(record);assert.equal(record.sha256,audit.asset.descriptorSha256);
 const asset=record.asset,snapshotBytes=await fs.readFile(path.join(root,path.dirname(record.path),'source-snapshot.json')),snapshot=JSON.parse(snapshotBytes);
 assert.equal(asset.source.type,'archive');assert.equal(snapshotBytes.length,asset.source.bytes);assert.equal(assetDigest(snapshotBytes),asset.source.sha256);
 assert.equal(snapshot.files.length,1);assert.equal(snapshot.files[0].path,'index.ts');
 assert.equal(assetDigest(snapshot.files[0].content),'042db40fdd88c902d73a7a58234fa78767085a6497fc9d5615c140c3b03c3506');
 assert.equal(assetDigest(await fs.readFile(path.join(root,path.dirname(asset.recipe.path),'source/index.ts'))),assetDigest(snapshot.files[0].content));
 assert.equal(assetDigest(await fs.readFile(path.join(root,asset.recipe.path))),asset.recipe.sha256);
 assert.doesNotMatch(JSON.stringify(asset)+snapshotBytes.toString(),/\/Users\/|ai-plug-|0ffdaccb-f962-41d0-9316-f98670d5dab4|dev@localhost/);
});

test('All eight Python-context targets pin actual reproduced bytes; source validation does not claim cross-platform execution',async()=>{
 const loaded=await loadRepository(root),asset=loaded.assets.find(item=>item.asset.id==='plugin-python-context').asset,publication=toToolPublication(asset);
 assert.equal(asset.kind,'plugin');assert.equal(publication.name,'Контекст Python');assert.match(publication.description,/pytest, Ruff и mypy/);assert.match(publication.description,/команды не запускает/);
 const descriptors=asset.delivery.artifacts.map(item=>item.descriptor);assert.equal(descriptors.length,8);assert.equal(new Set(descriptors.map(item=>item.target)).size,8);
 for(const item of descriptors){assert.equal(item.sha256,'4d1171bbe0c10f110a6e3b7c2bcaee75f63d82006333e5646b2debca7999439e');assert.equal(item.compressedBytes,1011);assert.equal(item.unpackedBytes,2099);assert.equal(item.filesCount,2);assert.equal(item.entrypoint,'entrypoint.mjs');}
 assert.equal(audit.oldRuntimeRestoredExactly,true);assert.equal(audit.nativePackageSelfVerified,true);assert.equal(audit.nativeExecution,'darwin-arm64');
 assert.equal(audit.hookCases.length,6);assert.ok(audit.hookCases.every(item=>item.passed));assert.equal(audit.staticTargets.length,8);
});
