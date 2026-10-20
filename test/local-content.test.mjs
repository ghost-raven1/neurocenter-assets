import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,lstat,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateAsset,serializeAsset,assetDigest,toToolPublication,createToolAsset,downloadArtifacts,fetchArtifact,assertIndexEvolution} from '../lib/index.mjs';

const original=JSON.parse(await readFile(new URL('../assets/mcp-filesystem/1.0.0/asset.json',import.meta.url),'utf8'));
function local(){const asset=structuredClone(original);asset.id='local-filesystem';asset.version='source-v1';asset.source={type:'archive',sha256:assetDigest('checked-source-snapshot'),bytes:Buffer.byteLength('checked-source-snapshot')};for(const artifact of asset.delivery.artifacts)delete artifact.url;return asset;}
const indexed=(asset)=>({id:asset.id,kind:asset.kind,version:asset.version,path:`assets/${asset.id}/${asset.version}/asset.json`,sha256:assetDigest(serializeAsset(asset)),current:true});

test('Archive source and content-only native delivery roundtrip without changing package pins',()=>{
    const asset=local(),native=toToolPublication(validateAsset(asset));
    assert.deepEqual(native.config.extra.runtimeArtifacts,toToolPublication(original).config.extra.runtimeArtifacts);
    assert.deepEqual(createToolAsset({id:asset.id,version:asset.version,source:asset.source,license:asset.license,publication:native,artifacts:asset.delivery.artifacts}),asset);
    assert.deepEqual(JSON.parse(serializeAsset(asset)),asset);
    assert.ok(downloadArtifacts(asset).every(item=>!Object.hasOwn(item,'url')&&item.bytes>0&&/^[a-f0-9]{64}$/.test(item.sha256)));
});

test('Source archive rejects missing/invalid hashes and nonpositive or fractional byte sizes',()=>{
    for(const change of [source=>delete source.sha256,source=>source.sha256='sha256:not-a-hash',source=>source.bytes=0,source=>source.bytes=-1,source=>source.bytes=1.5,source=>source.bytes=Number.MAX_SAFE_INTEGER+1]){
        const asset=local();change(asset.source);assert.throws(()=>validateAsset(asset));
    }
});

test('Archive provenance cannot contain server paths, credentials or device identifiers',()=>{
    for(const [key,value]of [['path','/Users/private/source.zip'],['url','file:///tmp/source.zip'],['token','private-key'],['deviceId','deployment-local-id'],['repository','https://github.com/invented/source']]){
        const asset=local();asset.source[key]=value;assert.throws(()=>validateAsset(asset),/structure or field/);
    }
    const asset=local();asset.card.id='deployment-local-id';assert.throws(()=>validateAsset(asset),/structure or field/);
});

test('Only an omitted URL denotes content-only; null, private or mutable transports fail',()=>{
    for(const url of [null,'','file:///tmp/private','http://localhost/api/blob','https://github.com/a/b/releases/download/latest/file.tgz','https://token@github.com/a/b/releases/download/v1/file.tgz']){
        const asset=local();asset.delivery.artifacts[0].url=url;assert.throws(()=>validateAsset(asset));
    }
});

test('A content reference always retains its complete native byte inventory',()=>{
    for(const key of ['sha256','compressedBytes','unpackedBytes','filesCount','entrypoint','target']){
        const asset=local();delete asset.delivery.artifacts[0].descriptor[key];assert.throws(()=>validateAsset(asset));
    }
});

test('Content-only fetch fails before network and before creating a file',async t=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'asset-content-only-'));t.after(()=>rm(directory,{recursive:true,force:true}));
    let calls=0;const destination=path.join(directory,'unused');
    for(const artifact of downloadArtifacts(local()))await assert.rejects(fetchArtifact(artifact,destination,{fetch:async()=>{calls++;throw new Error('Network forbidden');}}),/already verified local blob/);
    assert.equal(calls,0);await assert.rejects(lstat(destination),{code:'ENOENT'});
});

test('Adding a real release transport requires a new source version and preserves native pins',()=>{
    const before=local(),published=structuredClone(before);
    published.version='release-v1';published.source={type:'release',repository:'https://github.com/ghost-raven1/neurocenter-assets',tag:'release-v1'};
    published.delivery.artifacts.forEach((artifact,index)=>artifact.url=`https://github.com/ghost-raven1/neurocenter-assets/releases/download/release-v1/tool-${index}.tgz`);
    assert.deepEqual(toToolPublication(published),toToolPublication(before));
    const oldIndex={schemaVersion:1,assets:[indexed(before)]};
    assert.doesNotThrow(()=>assertIndexEvolution(oldIndex,{schemaVersion:1,assets:[{...indexed(before),current:false},indexed(published)]}));
    published.version=before.version;
    assert.throws(()=>assertIndexEvolution(oldIndex,{schemaVersion:1,assets:[indexed(published)]}),/changed|immutable/i);
});
