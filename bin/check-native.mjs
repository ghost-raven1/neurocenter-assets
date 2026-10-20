#!/usr/bin/env node
// Development-only integration check against the actual app source, without DB writes or installs.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadRepository,toToolPublication,toSkillCreate,toModelRecord,toBridgeRelease,createToolAsset,validateAsset} from '../lib/index.mjs';

const app=path.resolve(process.argv[2]||'../neurocenter');
const require=createRequire(path.join(app,'services/catalog-service/package.json'));
const ts=require('typescript');
const previous=require.extensions['.ts'];
require.extensions['.ts']=(module,filename)=>{
  const result=ts.transpileModule(readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,experimentalDecorators:true}});
  module._compile(result.outputText,filename);
};
try {
  const {validatePublication}=require('./src/publication/publication-validation.ts');
  const {buildPackage,verifyPackage}=require('./src/catalog/bundle-package.ts');
  const {validateModelCreate,validateModelDescriptor}=require('./src/models/model-validation.ts');
  const skillRequire=createRequire(path.join(app,'services/skills-service/package.json'));
  const {validateSkillCreate}=skillRequire('./src/skills/skill-validation.ts');
  const {renderSkillInstruction}=require('../shared/skill-package.cjs');
  const {normalizeRuntimeArtifacts}=require('../shared/runtime-artifacts.cjs');
  const {validateBridgeRuntimeRelease}=await import(pathToFileURL(path.join(app,'scripts/bridge-runtime-artifacts.mjs')));
  const {validateModelBundle}=await import(pathToFileURL(path.join(app,'scripts/models/bundle-manifest.mjs')));
  const repository=await loadRepository(fileURLToPath(new URL('../',import.meta.url)));
  const checked=[];
  for(const {asset}of repository.assets) {
    if(['mcp','plugin'].includes(asset.kind)) {
      const native=toToolPublication(asset),publication=validatePublication(native);
      const rebuilt=createToolAsset({id:asset.id,version:asset.version,source:asset.source,license:asset.license,publication:native,artifacts:asset.delivery.artifacts});
      assert.deepEqual(rebuilt,asset,'Tool producer/consumer roundtrip changed bytes or fields');
      assert.deepEqual(normalizeRuntimeArtifacts(publication.config.extra.runtimeArtifacts),normalizeRuntimeArtifacts(asset.delivery.artifacts.map(item=>item.descriptor)));
      const pkg=buildPackage({id:'ai-plug-contract-'+asset.id,name:publication.name,kind:asset.kind,version:1},publication.files,'2026-10-20T00:00:00Z',publication.config);
      assert.equal(pkg.schemaVersion,5);assert.equal(verifyPackage(pkg),true);
      for(const artifact of asset.delivery.artifacts)assert.equal(JSON.stringify(pkg.config).includes(artifact.url),false,'Upstream URL leaked into device delivery config');
      checked.push({id:asset.id,kind:asset.kind,nativePackage:pkg.schemaVersion});
    }else if(asset.kind==='skill') {
      const skill=validateSkillCreate(toSkillCreate(asset));
      const files=[{path:skill.slug+'/SKILL.md',content:renderSkillInstruction({slug:skill.slug,...skill.meta},skill.body)},...(skill.resources||[]).map(item=>({...item,path:skill.slug+'/'+item.path}))];
      const pkg=buildPackage({id:'common/'+skill.slug,name:skill.name,kind:'skill',version:1},files,'2026-10-20T00:00:00Z');
      assert.equal(verifyPackage(pkg),true);checked.push({id:asset.id,kind:asset.kind,nativePackage:pkg.schemaVersion});
    }else if(asset.kind==='model') {
      const card=toModelRecord(asset),descriptor=card.descriptor;
      validateModelCreate({name:card.name,description:descriptor.description,capability:descriptor.capability,runtime:descriptor.runtime,model:descriptor.model,dimension:descriptor.dimension,
        ...(descriptor.modelVersion===undefined?{}:{modelVersion:descriptor.modelVersion})});
      if(validateModelDescriptor)validateModelDescriptor(card.descriptor);
      if(asset.delivery.type==='model-bundle')validateModelBundle(asset.delivery.bundle,[asset.delivery.lock]);
      checked.push({id:asset.id,kind:asset.kind,delivery:asset.delivery.type});
    }else {
      assert.deepEqual(validateBridgeRuntimeRelease(toBridgeRelease(asset)),asset.delivery.release);
      checked.push({id:asset.id,kind:asset.kind,protocol:asset.compatibility.bridgeProtocol});
    }
  }
  const dependency=repository.assets.find(item=>item.asset.kind==='mcp'),parent=structuredClone(repository.assets.find(item=>item.asset.kind==='plugin').asset);
  const child=validatePublication(toToolPublication(dependency.asset));
  const nativeChild={id:'ai-plug-contract-dependency',name:child.name,kind:'mcp',version:1};
  const childPackage=buildPackage(nativeChild,child.files,'2026-10-20T00:00:00Z',child.config);
  parent.dependencies=[{id:dependency.asset.id,version:dependency.asset.version,sha256:dependency.sha256}];
  const native={kind:'mcp',id:nativeChild.id,version:1,manifest:childPackage.manifest.sha256};
  const context={dependencies:[{...parent.dependencies[0],kind:'mcp',native}]},publication=validatePublication(toToolPublication(parent,context));
  assert.deepEqual(publication.dependencies,[native]);
  const exported=createToolAsset({id:parent.id,version:parent.version,source:parent.source,license:parent.license,publication,artifacts:parent.delivery.artifacts,dependencies:parent.dependencies,resolvedDependencies:context});
  assert.deepEqual(exported,parent);assert.equal(JSON.stringify(exported).includes(nativeChild.id),false);
  checked.push({id:parent.id,kind:'dependency-mapping',nativeManifestVerified:verifyPackage(childPackage)});
  if(validateModelDescriptor) {
    const local=repository.assets.find(item=>item.asset.kind==='model').asset;
    const descriptor={description:'Remote integration fixture',capability:'embedding',runtime:'remote-openai',model:'test-embedding',modelVersion:'2026-10-20',manifestSha256:null,dimension:128,verificationSha256:null,source:'custom'};
    const remote=validateAsset({...local,id:'model-contract-remote',card:{id:'model-contract-remote',name:'Remote fixture',descriptor},delivery:{type:'remote-api'}});
    validateModelDescriptor(toModelRecord(remote).descriptor);checked.push({id:remote.id,kind:'model',delivery:'remote-api'});
  }
  process.stdout.write(JSON.stringify({ok:true,sourceValidators:true,checked},null,2)+'\n');
}finally{if(previous)require.extensions['.ts']=previous;else delete require.extensions['.ts'];}
