import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadRepository,validateIndex,assertIndexEvolution,serializeAsset,assetDigest,selectAssets,toToolPublication,toSkillCreate,toModelRecord,toBridgeRelease,createToolAsset,validateAsset} from '../lib/index.mjs';
const loaded=await loadRepository(fileURLToPath(new URL('../',import.meta.url)));
const base=kind=>structuredClone(loaded.assets.find(item=>item.asset.kind===kind).asset);
const resolve=(asset,current=true)=>({asset,current,sha256:assetDigest(serializeAsset(asset)),path:`assets/${asset.id}/${asset.version}/asset.json`});
const entry=record=>({id:record.asset.id,kind:record.asset.kind,version:record.asset.version,sha256:record.sha256,path:record.path,current:record.current});
function history() {
  const b1=resolve(base('mcp'),false),b2=structuredClone(b1);b2.asset.version='2.0.0';b2.asset.card.revision='2.0.0';
  const current=resolve(b2.asset),a=base('plugin');a.dependencies=[{id:b1.asset.id,version:b1.asset.version,sha256:b1.sha256}];
  const parent=resolve(a),records=[parent,b1,current];return {parent,b1,b2:current,records,index:{schemaVersion:1,assets:records.map(entry)}};
}
test('A→Bv1 остаётся разрешимым при current Bv2; явный B не подменяет историческую зависимость',()=>{
  const {parent,b1,b2,records,index}=history();validateIndex(index);
  assert.deepEqual(selectAssets(records,[parent.asset.id]).map(item=>[item.asset.id,item.asset.version,item.current]),[[b1.asset.id,b1.asset.version,false],[parent.asset.id,parent.asset.version,true]]);
  assert.deepEqual(selectAssets(records,[parent.asset.id,b2.asset.id]).map(item=>[item.asset.id,item.asset.version,item.current]),[[b1.asset.id,b1.asset.version,false],[parent.asset.id,parent.asset.version,true],[b2.asset.id,b2.asset.version,true]]);
  assert.deepEqual(selectAssets(records,[b2.asset.id]).map(item=>item.asset.version),['2.0.0']);
  assert.throws(()=>selectAssets([parent,b2],[parent.asset.id]),/pin mismatch/);
});
for(const [name,change]of [
  ['два current',index=>{index.assets[1].current=true;}],
  ['нет current',index=>{index.assets[2].current=false;}],
  ['current не boolean',index=>{index.assets[2].current='true';}],
  ['current пропущен',index=>{delete index.assets[2].current;}],
  ['два SHA одной версии',index=>{index.assets.push({...index.assets[1],sha256:'f'.repeat(64)});}],
  ['один ID меняет kind',index=>{index.assets[2].kind='plugin';}],
])test(`Исторический index отклоняет: ${name}`,()=>{const {index}=history();change(index);assert.throws(()=>validateIndex(index));});
test('Эволюция index сохраняет published bytes и историю; версию нельзя удалить и переиспользовать',()=>{
  const {index,b1,parent}=history(),previous={schemaVersion:1,assets:[entry(parent),{...entry(b1),current:true}]};
  assertIndexEvolution(previous,index);
  const changed=structuredClone(index);changed.assets[1].sha256='f'.repeat(64);assert.throws(()=>assertIndexEvolution(previous,changed),/bytes/);
  const disappeared=structuredClone(index);disappeared.assets.splice(1,1);assert.throws(()=>assertIndexEvolution(previous,disappeared),/disappear/);
  assert.throws(()=>assertIndexEvolution(previous,changed),/bytes/);
  const wrongPin=history();wrongPin.b1.sha256='a'.repeat(64);assert.throws(()=>selectAssets(wrongPin.records,[wrongPin.parent.asset.id]),/pin mismatch/);
});
test('Public card не сохраняет чужие native IDs и не теряет portable dependency без контекста',()=>{
  const {parent,b1}=history(),asset=parent.asset;
  assert.throws(()=>toToolPublication(asset),/Resolve portable/);
  const native={kind:b1.asset.kind,id:'ai-plug-local-dependency',version:3,manifest:'a'.repeat(64)};
  const context={dependencies:[{...asset.dependencies[0],kind:b1.asset.kind,native}]};
  const publication=toToolPublication(asset,context);assert.deepEqual(publication.dependencies,[native]);
  const exported=createToolAsset({id:asset.id,version:asset.version,source:asset.source,license:asset.license,publication,artifacts:asset.delivery.artifacts,dependencies:asset.dependencies,resolvedDependencies:context});
  assert.deepEqual(exported,asset);assert.equal(JSON.stringify(exported).includes(native.id),false);
  assert.throws(()=>createToolAsset({id:asset.id,version:asset.version,source:asset.source,license:asset.license,publication,artifacts:asset.delivery.artifacts}),/source mapping context/);
  const leaked=structuredClone(asset);leaked.card.dependencies=[native];assert.throws(()=>validateAsset(leaked),/deployment-native/);
  const wrong=structuredClone(context);wrong.dependencies[0].sha256='f'.repeat(64);assert.throws(()=>toToolPublication(asset,wrong),/differs/);
  assert.throws(()=>toToolPublication(asset,{dependencies:[]}),/cover exactly/);
});
test('Skill получает проверенные native pins, а infrastructure не превращается в MCP dependency',()=>{
  const {parent,b1}=history(),skill=base('skill');skill.dependencies=parent.asset.dependencies;
  const native={kind:b1.asset.kind,id:'ai-plug-local-dependency',version:3,manifest:'a'.repeat(64)},context={dependencies:[{...skill.dependencies[0],kind:b1.asset.kind,native}]};
  assert.throws(()=>toSkillCreate(skill),/Resolve portable/);assert.deepEqual(toSkillCreate(skill,context).meta.dependencies,[native]);
  const leaked=structuredClone(skill);leaked.card.meta.dependencies=[native];assert.throws(()=>validateAsset(leaked),/deployment-native/);
  const wrong=structuredClone(context);wrong.dependencies[0].kind='model';assert.throws(()=>toSkillCreate(skill,wrong),/Infrastructure/);
  const model=base('model'),bridge=base('bridge');model.dependencies=skill.dependencies;bridge.dependencies=skill.dependencies;
  assert.deepEqual(toModelRecord(model),model.card);assert.deepEqual(toBridgeRelease(bridge),bridge.delivery.release);
  assert.deepEqual(model.dependencies,skill.dependencies);assert.deepEqual(bridge.dependencies,skill.dependencies);
});
