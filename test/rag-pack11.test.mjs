import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadRepository,downloadArtifacts,assetDigest,serializeAsset} from '../lib/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const loaded=await loadRepository(root);
const audit=JSON.parse(await readFile(new URL('../audit/rag-pack11-2026-10-23.json',import.meta.url),'utf8'));

test('RAG pack.11 is current on all seven targets while previous descriptor bytes remain immutable',()=>{
 for(const old of audit.previousDescriptors){
  const record=loaded.assets.find(item=>item.asset.id===old.id&&item.asset.version===old.version);
  assert.ok(record);assert.equal(record.sha256,old.sha256);assert.equal(assetDigest(serializeAsset(record.asset)),old.sha256);
 }
 for(const next of audit.assets){
  const current=loaded.assets.filter(item=>item.current&&item.asset.id===next.id);
  assert.equal(current.length,1);assert.equal(current[0].asset.version,next.version);assert.equal(current[0].sha256,next.descriptorSha256);
  assert.deepEqual(current[0].asset.delivery.artifacts.map(item=>item.descriptor.target).sort(),[...next.targets].sort());
 }
});

test('Every pack.11 transport has anonymous HTTPS SHA and size evidence without substituting foreign runtime acceptance',()=>{
 assert.equal(audit.readback.ok,true);assert.equal(audit.readback.authentication,'none');assert.equal(audit.readback.tlsVerification,true);
 assert.equal(audit.readback.files.length,15);const files=new Map(audit.readback.files.map(item=>[item.url,item]));
 for(const next of audit.assets){
  const record=loaded.assets.find(item=>item.asset.id===next.id&&item.asset.version===next.version);
  for(const artifact of downloadArtifacts(record.asset)){
   const proof=files.get(artifact.url);assert.ok(proof);assert.equal(proof.sha256,artifact.sha256);assert.equal(proof.bytes,artifact.bytes);
  }
 }
 assert.deepEqual(audit.runtime.executedTargets,['darwin-arm64']);assert.equal(audit.runtime.linuxWindowsExecuted,false);
 assert.equal(audit.runtime.modelInferenceExecuted,false);
});
