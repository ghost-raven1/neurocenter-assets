import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {loadRepository,assetDigest,serializeAsset} from '../lib/index.mjs';
const execute=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url)),cli=path.join(root,'bin/assets.mjs');
async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'neurocenter assets '));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.cp(path.join(root,'assets'),path.join(directory,'assets'),{recursive:true});await fs.copyFile(path.join(root,'index.json'),path.join(directory,'index.json'));
  await fs.cp(path.join(root,'recipes'),path.join(directory,'recipes'),{recursive:true});
  return directory;
}
test('Репозиторий читается из cwd с пробелами, validate и preview не меняют файлы',async t=>{
  const directory=await fixture(t),before=await fs.readFile(path.join(directory,'index.json'));
  const validation=JSON.parse((await execute(process.execPath,[cli,'validate','.'],{cwd:directory})).stdout);
  assert.equal(validation.ok,true);assert.equal(validation.assets,JSON.parse(before).assets.length);
  const preview=JSON.parse((await execute(process.execPath,[cli,'preview','.',validation.kinds.includes('mcp')?'mcp-filesystem':'missing'],{cwd:directory})).stdout);
  assert.equal(preview.dryRun,true);assert.equal(preview.assets.length,1);assert.equal(preview.assets[0].native.kind,'mcp');
  assert.deepEqual(await fs.readFile(path.join(directory,'index.json')),before);
});
test('Изменённые после индекса байты не проходят SHA до разбора JSON',async t=>{
  const directory=await fixture(t),loaded=await loadRepository(directory),file=path.join(directory,loaded.index.assets[0].path);
  await fs.appendFile(file,'\n');await assert.rejects(loadRepository(directory),/Descriptor SHA mismatch/);
});
test('Симлинк вместо descriptor и симлинк в родительском каталоге отклоняются',async t=>{
  const directory=await fixture(t),loaded=await loadRepository(directory),relative=loaded.index.assets[0].path,file=path.join(directory,relative),original=file+'.original';
  await fs.rename(file,original);await fs.symlink(original,file);await assert.rejects(loadRepository(directory),/Unsafe repository file/);
  await fs.unlink(file);await fs.rename(original,file);
  const parent=path.dirname(file);await fs.rename(parent,parent+'.original');await fs.symlink(parent+'.original',parent);
  await assert.rejects(loadRepository(directory),/Unsafe repository file/);
});
test('Hardlink и неверный UTF-8 не маскируются под обычный descriptor',async t=>{
  const directory=await fixture(t),loaded=await loadRepository(directory),file=path.join(directory,loaded.index.assets[0].path);
  await fs.link(file,file+'.link');await assert.rejects(loadRepository(directory),/Unsafe repository file/);await fs.unlink(file+'.link');
  await fs.writeFile(file,Buffer.from([0xff,0xfe]));await assert.rejects(loadRepository(directory),/not UTF-8/);
});
test('Pinned recipe проверяется до появления готового результата',async t=>{
  const directory=await fixture(t),loaded=await loadRepository(directory),entry=loaded.index.assets[0],record=loaded.assets[0];
  await fs.mkdir(path.join(directory,'recipes'),{recursive:true});await fs.writeFile(path.join(directory,'recipes/tool.json'),'{}\n');
  record.asset.recipe={path:'recipes/tool.json',sha256:assetDigest('{}\n')};
  const bytes=serializeAsset(record.asset);entry.sha256=assetDigest(bytes);await fs.writeFile(path.join(directory,entry.path),bytes);await fs.writeFile(path.join(directory,'index.json'),JSON.stringify(loaded.index));
  assert.equal((await loadRepository(directory)).assets.length,loaded.assets.length);
  await fs.writeFile(path.join(directory,'recipes/tool.json'),'{}');await assert.rejects(loadRepository(directory),/Recipe SHA mismatch/);
});
test('CLI не принимает неизвестные команды и отсутствие явного выбора',async()=>{
  await assert.rejects(execute(process.execPath,[cli,'preview',root]),error=>error.code===1);
  await assert.rejects(execute(process.execPath,[cli,'--download-everything',root]),error=>error.code===1);
  const help=await execute(process.execPath,[cli,'--help']);assert.match(help.stdout,/Commands are local/);assert.equal(help.stdout.trim().endsWith('true'),false);
});
test('Producer CLI создаёт готовый descriptor и не перезаписывает существующий файл',async t=>{
  const directory=await fixture(t),loaded=await loadRepository(directory),asset=loaded.assets.find(item=>item.asset.kind==='mcp').asset;
  const publication=structuredClone(asset.card);publication.config.extra={...publication.config.extra,runtimeArtifacts:asset.delivery.artifacts.map(item=>item.descriptor)};
  const input={id:asset.id,version:asset.version,source:asset.source,license:asset.license,publication,artifacts:asset.delivery.artifacts};
  await fs.writeFile(path.join(directory,'prepared.json'),JSON.stringify(input));
  const result=JSON.parse((await execute(process.execPath,[cli,'export-tool','prepared.json','result.json'],{cwd:directory})).stdout);assert.equal(result.ok,true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8')),asset);
  const before=await fs.readFile(path.join(directory,'result.json'));await assert.rejects(execute(process.execPath,[cli,'export-tool','prepared.json','result.json'],{cwd:directory}),error=>error.code===1);
  assert.deepEqual(await fs.readFile(path.join(directory,'result.json')),before);
});
test('Reader и CLI сохраняют исторический exact dependency при новом current',async t=>{
  const directory=await fixture(t),loaded=await loadRepository(directory),old=loaded.assets.find(item=>item.asset.kind==='mcp'),parent=loaded.assets.find(item=>item.asset.kind==='plugin');
  const next=structuredClone(old.asset);next.version='2.0.0';const a=structuredClone(parent.asset);a.version='2.0.0';a.dependencies=[{id:old.asset.id,version:old.asset.version,sha256:old.sha256}];
  for(const asset of [next,a]) {
    const bytes=serializeAsset(asset),relative=`assets/${asset.id}/${asset.version}/asset.json`;
    await fs.mkdir(path.dirname(path.join(directory,relative)),{recursive:true});await fs.writeFile(path.join(directory,relative),bytes);
    loaded.index.assets.find(item=>item.id===asset.id).current=false;loaded.index.assets.push({id:asset.id,kind:asset.kind,version:asset.version,sha256:assetDigest(bytes),path:relative,current:true});
  }
  await fs.writeFile(path.join(directory,'index.json'),JSON.stringify(loaded.index));
  const read=await loadRepository(directory);assert.equal(read.assets.find(item=>item.asset.id===old.asset.id&&item.asset.version===old.asset.version).current,false);
  const report=JSON.parse((await execute(process.execPath,[cli,'validate',directory])).stdout);assert.equal(report.ok,true);assert.equal(report.assets,read.assets.length);
});
