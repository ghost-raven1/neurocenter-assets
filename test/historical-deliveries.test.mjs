import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {assetDigest,loadRepository,downloadArtifacts,serializeAsset} from '../lib/index.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),loaded=await loadRepository(root),audit=JSON.parse(await readFile(new URL('../audit/historical-deliveries-2026-10-20.json',import.meta.url),'utf8'));

test('Historical data migration preserves every previously published descriptor byte and all nine tool deliveries',()=>{
 for(const entry of audit.preserved){const actual=loaded.assets.find(r=>r.asset.id===entry.id&&r.asset.version===entry.version);assert.ok(actual);assert.equal(actual.sha256,entry.sha256);assert.equal(assetDigest(serializeAsset(actual.asset)),entry.sha256);}
 const tools=audit.exported.filter(entry=>entry.kind==='mcp'||entry.kind==='plugin');assert.equal(tools.length,9);assert.equal(new Set(tools.map(entry=>entry.id)).size,9);
 for(const entry of audit.exported){const actual=loaded.assets.find(r=>r.asset.id===entry.id&&r.asset.version===entry.version);assert.ok(actual);assert.equal(actual.sha256,entry.sha256);assert.equal(actual.path,entry.path);}
 assert.equal(loaded.assets.find(r=>r.asset.id==='mcp-opencode-rag').asset.card.revision,'2.4.4-mcp.pack.8');
 assert.equal(loaded.assets.find(r=>r.asset.id==='plugin-opencode-rag-plugin').asset.card.revision,'2.4.4-plugin.pack.8');
 assert.match(audit.scope,/no large payload download/);assert.match(audit.rag,/pack\.9.*separately/);
});
test('Every historical tool and vision transport has exact provider SHA/size evidence, separately from local byte proof',()=>{
 const transports=audit.exported.flatMap(entry=>downloadArtifacts(loaded.assets.find(r=>r.asset.id===entry.id&&r.asset.version===entry.version).asset).map(item=>({id:entry.id,version:entry.version,sha256:item.sha256,bytes:item.bytes,url:item.url})));
 assert.deepEqual(transports,audit.transports);assert.equal(new Set(transports.filter(t=>!t.id.startsWith('model-')).map(t=>t.sha256)).size,22);
 for(const transport of transports){const remote=audit.releases.flatMap(release=>release.assets).filter(asset=>asset.url===transport.url);assert.equal(remote.length,1);assert.equal(remote[0].state,'uploaded');assert.equal(remote[0].sha256,transport.sha256);assert.equal(remote[0].size,transport.bytes);}
 const vision=loaded.assets.find(r=>r.asset.id==='model-vision-qwen3-vl-2b').asset;assert.equal(vision.card.descriptor.capability,'vision');assert.equal(vision.delivery.bundle.files.length,6);assert.equal(downloadArtifacts(vision).length,6);
 assert.equal(vision.license.spdx,'Apache-2.0');assert.equal(vision.license.url,audit.licenseReadback.url);assert.equal(audit.licenseReadback.sha256,'7339fa418c9ad3e8e12e74ad0fd26a9cc4be8703f9c110728a992b193be85cb2');
 assert.equal(vision.delivery.bundle.files.some(file=>file.sha256==='2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b'),false);
});
