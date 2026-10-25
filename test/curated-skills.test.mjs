import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadRepository,toSkillCreate} from '../lib/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const notices={
  'antfu/skills':'29f64e0a93476a23cb4e5864696f673bf05caa43',
  'supabase/agent-skills':'d3c9e94fbc6c28f66ecb5a01407d543c99c811b6',
  'ejirocodes/agent-skills':'76ad3ccf5b119deed4e46e8386ab92f4ab23d28a',
  'currents-dev/playwright-best-practices-skill':'0312fd7de9487ced54515687d0026fc146aba947',
  'anthropics/skills':'4f881c52d1f72f4cfb720e339e2d35c3058d01a9',
  'wshobson/agents':'326f0a55c96e672fedf9d807ca043c00df05ba0e',
};

test('Curated skills preserve upstream notices, original instructions and all bundled resources',async()=>{
  const repository=await loadRepository(root);
  const skills=repository.assets.filter(({asset})=>asset.kind==='skill'&&asset.version==='1.0.0'&&asset.source.type==='git'
    &&Object.hasOwn(notices,asset.source.repository.replace('https://github.com/','')));
  assert.equal(skills.length,12);
  assert.equal(skills.reduce((sum,{asset})=>sum+asset.card.resources.length,0),187);
  for(const {asset}of skills){
    const card=toSkillCreate(asset),repo=asset.source.repository.replace('https://github.com/','');
    const notice=card.resources.find(item=>item.path==='references/LICENSE.upstream.txt');
    const bytes=Buffer.from(notice.content);
    assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),notices[repo],asset.id);
    const source=card.resources.find(item=>item.path==='references/SOURCE.md').content;
    const provenance=JSON.parse(source.match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.equal(provenance.repository,asset.source.repository);assert.equal(provenance.commit,asset.source.commit);
    assert.equal(provenance.license,asset.license.spdx);
    const original=card.resources.find(item=>item.path==='references/upstream-SKILL.txt');
    const originalPin=provenance.upstream_files.find(item=>item.path==='SKILL.md');
    assert.equal(createHash('sha256').update(original.content).digest('hex'),originalPin.sha256,asset.id);
    for(const key of ['owner','generation','history','updatedAt','version'])assert.equal(Object.hasOwn(card.meta,key),false);
    assert.equal(JSON.stringify(asset).includes('/Users/aleksejstarodubcev/'),false);
  }
});
