import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {loadRepository,validateAsset,validateIndex,selectAssets,assetDigest,serializeAsset,createToolAsset,toToolPublication,toSkillCreate,toModelRecord,toBridgeRelease,downloadArtifacts} from '../lib/index.mjs';

const loaded=await loadRepository(fileURLToPath(new URL('../',import.meta.url)));
const tool=loaded.assets.find(item=>item.asset.kind==='mcp').asset;
const plugin=loaded.assets.find(item=>item.asset.kind==='plugin').asset;
const model=loaded.assets.find(item=>item.asset.kind==='model').asset;
const bridge=loaded.assets.find(item=>item.asset.kind==='bridge').asset;
const skill=loaded.assets.find(item=>item.asset.kind==='skill').asset;
const mutate=(asset,change)=>{const value=structuredClone(asset);change(value);return value;};
const record=asset=>({asset,sha256:assetDigest(serializeAsset(asset)),path:`assets/${asset.id}/${asset.version}/asset.json`,current:true});

test('Пять настоящих видов ассетов сохраняют родные форматы и не мутируют оригинал',()=>{
  assert.deepEqual(new Set(loaded.assets.map(item=>item.asset.kind)),new Set(['mcp','plugin','model','bridge','skill']));
  const original=serializeAsset(tool),publication=toToolPublication(tool);
  assert.equal(Object.hasOwn(tool.card.config.extra||{},'runtimeArtifacts'),false);
  assert.deepEqual(publication.config.extra.runtimeArtifacts,tool.delivery.artifacts.map(item=>item.descriptor));
  assert.deepEqual(createToolAsset({id:tool.id,version:tool.version,source:tool.source,license:tool.license,publication,artifacts:tool.delivery.artifacts}),tool);
  assert.equal(serializeAsset(tool),original);
  assert.deepEqual(toSkillCreate(skill),skill.card);assert.deepEqual(toModelRecord(model),model.card);assert.deepEqual(toBridgeRelease(bridge),bridge.delivery.release);
  assert.equal(downloadArtifacts(skill).length,0);assert.ok(downloadArtifacts(model).every(item=>item.filename.endsWith('.bin')));
});
test('SHA учитывает фактические байты и newline, а не неявную JSON-нормализацию',()=>{
  assert.notEqual(assetDigest('{}'),assetDigest('{}\n'));assert.equal(assetDigest(Buffer.from('abc')),assetDigest('abc'));
  assert.throws(()=>assetDigest(tool),/exact bytes/);
  const unordered=Object.fromEntries(Object.entries(tool).reverse());assert.equal(serializeAsset(unordered),serializeAsset(tool));
  assert.throws(()=>serializeAsset(mutate(tool,a=>{a.card.config.args=new Array(2);})),/unsupported value/);
});
test('Опубликованный скилл содержит текущую инструкцию и полный контракт без потери ресурсов',async()=>{
  const source=await readFile(new URL('../skills/neurocenter-packaging/SKILL.md',import.meta.url),'utf8');
  assert.equal(skill.card.body,source.replace(/^---\n[\s\S]*?\n---\n/,'').trim());
  assert.equal(skill.card.resources[0].content,await readFile(new URL('../skills/neurocenter-packaging/references/contract.md',import.meta.url),'utf8'));
});
test('CommonJS consumer получает тот же пакет под Node24',()=>{
  const require=createRequire(new URL('../package.json',import.meta.url));assert.equal(require('@neurocenter/asset-contract').validateAsset(tool).id,tool.id);
});

const invalid=[
  ['пропущен ID',asset=>{delete asset.id;}],
  ['неизвестная версия',asset=>{asset.schemaVersion=2;}],
  ['неизвестное поле',asset=>{asset.future=true;}],
  ['неподдерживаемый формат',asset=>{asset.compatibility.packageFormat=6;}],
  ['плавающая версия',asset=>{asset.version='latest';}],
  ['неизвестное поле source',asset=>{asset.source.token='secret';}],
  ['короткий Git SHA',asset=>{asset.source.commit='abcdef0';}],
  ['Git SHA не строка',asset=>{asset.source.commit=['a'.repeat(40)];}],
  ['artifact SHA не строка',asset=>{asset.delivery.artifacts[0].descriptor.sha256=['a'.repeat(64)];}],
  ['повторная опись runtime',asset=>{asset.card.config.extra={runtimeArtifacts:asset.delivery.artifacts.map(item=>item.descriptor)};}],
  ['повторяющийся target',asset=>{asset.delivery.artifacts.push(asset.delivery.artifacts[0]);}],
  ['противоречивые размеры одного SHA',asset=>{asset.delivery.artifacts[1].descriptor.compressedBytes++;}],
  ['выход entrypoint из папки',asset=>{asset.delivery.artifacts[0].descriptor.entrypoint='../outside.mjs';}],
  ['плавающий URL релиза',asset=>{asset.delivery.artifacts[0].url='https://github.com/a/b/releases/latest/download/file.tar.gz';}],
  ['URL с credential',asset=>{asset.delivery.artifacts[0].url='https://token@github.com/a/b/releases/download/v1/file.tar.gz';}],
  ['unknown artifact field',asset=>{asset.delivery.artifacts[0].descriptor.installHook='curl|sh';}],
];
for(const [label,change]of invalid)test(`Отклоняет: ${label}`,()=>assert.throws(()=>validateAsset(mutate(tool,change))));
test('Producer не скрывает расхождение собранных артефактов',()=>{
  const publication=toToolPublication(tool);publication.config.extra.runtimeArtifacts[0].sha256='a'.repeat(64);
  assert.throws(()=>createToolAsset({id:tool.id,version:tool.version,source:tool.source,license:tool.license,publication,artifacts:tool.delivery.artifacts}),/differ/);
});
test('Нативная программа не выдаётся за JS-плагин',()=>assert.throws(()=>validateAsset(mutate(plugin,a=>{a.delivery.artifacts[0].descriptor.executable=true;})),/JavaScript/));
test('Model bundle сверяется с SHA, содержимым lock и точным набором файлов',()=>{
  for(const change of [a=>{a.delivery.lock.manifestSha256='f'.repeat(64);},a=>{a.card.descriptor.dimension=128;},a=>{a.delivery.bundle.files.pop();},a=>{a.delivery.bundle.files.find(item=>item.parts).parts[0].size++;},a=>{a.delivery.bundle.files.find(item=>item.inlineBase64).inlineBase64=Buffer.from('{}').toString('base64');}])assert.throws(()=>validateAsset(mutate(model,change)));
});
test('Мост сохраняет отдельный kind, buildId, target и имя архива',()=>{
  assert.throws(()=>toToolPublication(bridge),/tool asset/);
  for(const change of [a=>{a.delivery.release.artifacts[0].metadata.buildId='a'.repeat(64);},a=>{a.delivery.release.artifacts[0].metadata.target='win32-arm64';},a=>{a.delivery.release.artifacts[0].file='other.tgz';}])assert.throws(()=>validateAsset(mutate(bridge,change)));
});
test('Remote model не содержит секретов и не заявляет проверку чужой площадки',()=>{
  const remote={...structuredClone(model),id:'model-test-remote',card:{id:'model-test-remote',name:'Remote fixture',descriptor:{description:'Remote fixture',capability:'embedding',runtime:'remote-openai',model:'test/model',modelVersion:'v1',manifestSha256:null,dimension:128,verificationSha256:null,source:'custom'}},delivery:{type:'remote-api'}};
  assert.equal(validateAsset(remote),remote);assert.deepEqual(downloadArtifacts(remote),[]);
  for(const change of [a=>{a.card.descriptor.endpoint='https://provider.example';},a=>{a.card.descriptor.apiKey='test';},a=>{a.card.descriptor.verificationSha256='a'.repeat(64);},a=>{a.card.descriptor.manifestSha256='a'.repeat(64);},a=>{delete a.card.descriptor.modelVersion;},a=>{a.card.descriptor.model='https://provider.example/model';}])assert.throws(()=>validateAsset(mutate(remote,change)));
});
test('Index не принимает путь, скрывающий другой ID или версию',()=>{
  for(const change of [a=>{a.assets[0].path='assets/../outside/asset.json';},a=>{a.assets[0].path='assets/different/1.0.0/asset.json';},a=>{a.assets.push(a.assets[0]);},a=>{delete a.assets[0].id;}])assert.throws(()=>validateIndex(mutate(loaded.index,change)));
});
test('Выбор явный, зависимости закреплены и идут до выбранного ассета',()=>{
  const dependency=record(tool),selected=record(mutate(plugin,a=>{a.dependencies=[{id:tool.id,version:tool.version,sha256:dependency.sha256}];}));
  assert.deepEqual(selectAssets([dependency,selected],[]),[]);
  assert.deepEqual(selectAssets([selected,dependency],[plugin.id]).map(item=>item.asset.id),[tool.id,plugin.id]);
  assert.throws(()=>selectAssets([selected],[plugin.id]),/pin mismatch/);
  assert.throws(()=>selectAssets([dependency],['missing']),/Missing/);
  assert.throws(()=>selectAssets([dependency,dependency],[tool.id]),/Duplicate/);
  const wrong=structuredClone(dependency);wrong.sha256='f'.repeat(64);assert.throws(()=>selectAssets([wrong,selected],[plugin.id]),/pin mismatch/);
  const a=record(mutate(tool,a=>{a.dependencies=[{id:plugin.id,version:plugin.version,sha256:selected.sha256}];}));
  const b=record(mutate(plugin,b=>{b.dependencies=[{id:tool.id,version:tool.version,sha256:a.sha256}];}));
  // SHA pins are separately checked; use equal fixture pins to expose the graph cycle itself.
  a.asset.dependencies[0].sha256=b.sha256;
  assert.throws(()=>selectAssets([a,b],[tool.id]),/Cyclic/);
});
