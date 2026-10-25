import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadRepository,selectAssets,toAgentRecord,toSkillCreate,downloadArtifacts,assetDigest} from '../lib/index.mjs';

const root=new URL('../',import.meta.url);
const roles=['planner','developer','reviewer','tester','documenter'];
const skills=['neurocenter-project-context','neurocenter-system-assistance','neurocenter-project-learning'];

test('selecting one project agent includes its three exact source skills without downloading binaries',async()=>{
 const repository=await loadRepository(root.pathname);
 for(const role of roles){
  const selected=selectAssets(repository.assets,['agent-'+role]);
  assert.deepEqual(selected.slice(0,-1).map(record=>record.asset.id),skills.map(slug=>'skill-'+slug));
  assert.equal(selected.at(-1).asset.version,'1.1.0');
  for(const record of selected)assert.deepEqual(downloadArtifacts(record.asset),[]);
  for(const dependency of selected.at(-1).asset.dependencies){
   const found=selected.find(record=>record.asset.id===dependency.id);
   assert.equal(found.asset.version,dependency.version);assert.equal(found.sha256,dependency.sha256);
  }
 }
});

test('native agent projections preserve role permissions and exact delivered prompt sources',async()=>{
 const repository=await loadRepository(root.pathname);
 for(const role of roles){
  const record=repository.assets.find(record=>record.current&&record.asset.id==='agent-'+role);
  const agent=toAgentRecord(record.asset),previous=repository.assets.find(item=>item.asset.id===record.asset.id&&item.asset.version==='1.0.0');
  assert.equal(agent.definition.prompt,await readFile(new URL(record.asset.source.path,root),'utf8'));
  assert.equal(agent.slug,'nc-'+role);assert.equal(agent.definition.permission.skill,'allow');
  const {skill,...permission}=agent.definition.permission;
  assert.deepEqual(permission,previous.asset.card.definition.permission);
  assert.equal(record.asset.source.commit,'5a82c73484ee7f2831db54309835e1305c0ff609');
  assert.equal(assetDigest(await readFile(new URL(previous.path,root))),previous.sha256);
 }
});

test('all delivered project skills project into ordinary common skill packages with their exact instructions',async()=>{
 const repository=await loadRepository(root.pathname);
 for(const slug of skills){
  const {asset}=repository.assets.find(record=>record.current&&record.asset.id==='skill-'+slug);
  const source=await readFile(new URL(asset.source.path,root),'utf8'),body=source.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)[1].trim()+'\n';
  const card=toSkillCreate(asset);
  assert.equal(card.path,'common');assert.equal(card.slug,slug);assert.equal(card.body,body);
  assert.deepEqual(card.meta.mcp,[]);assert.deepEqual(card.meta.plugins,[]);
 }
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 assert.ok(pkg.files.includes('agent-prompts'));
 for(const slug of skills)assert.ok(pkg.files.includes('skills/'+slug));
});
