import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fetchArtifact,assetDigest} from '../lib/index.mjs';
const bytes=Buffer.from('verified fixture bytes');
const artifact={url:'https://github.com/ghost-raven1/neurocenter-assets/releases/download/test-v1/fixture.tar.gz',filename:'fixture.tar.gz',sha256:assetDigest(bytes),bytes:bytes.length};
async function destination(t) {const directory=await fs.mkdtemp(path.join(os.tmpdir(),'asset-download-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return path.join(directory,'staging');}

test('Server supply скачивает pinned bytes через допустимый CDN redirect',async t=>{
  const file=await destination(t),urls=[];
  await fetchArtifact(artifact,file,{fetch:async(url,options)=>{
    urls.push(url);assert.equal(options.redirect,'manual');
    return urls.length===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/test/fixture?signature=test'}}):new Response(bytes,{headers:{'content-length':String(bytes.length)}});
  }});
  assert.equal(urls.length,2);assert.deepEqual(await fs.readFile(file),bytes);
});
for(const [label,response]of [
  ['неверный SHA',()=>new Response(Buffer.alloc(bytes.length,1))],
  ['превышение размера',()=>new Response(Buffer.concat([bytes,bytes]))],
  ['оборванный файл',()=>new Response(bytes.subarray(0,2))],
  ['неверный Content-Length',()=>new Response(bytes,{headers:{'content-length':'1'}})],
  ['HTTP отказ',()=>new Response('not found',{status:404})],
  ['небезопасный redirect',()=>new Response(null,{status:302,headers:{location:'http://localhost/private'}})],
  ['redirect loop',()=>new Response(null,{status:302,headers:{location:artifact.url}})],
])test(`После ошибки supply нет частичного файла: ${label}`,async t=>{
  const file=await destination(t);await assert.rejects(fetchArtifact(artifact,file,{fetch:async()=>response()}));await assert.rejects(fs.lstat(file),{code:'ENOENT'});
});
test('Повторная загрузка не перезаписывает существующий файл и не удаляет его при отказе',async t=>{
  const file=await destination(t);await fs.writeFile(file,'existing');
  await assert.rejects(fetchArtifact(artifact,file,{fetch:async()=>new Response(bytes)}),{code:'EEXIST'});assert.equal(await fs.readFile(file,'utf8'),'existing');
});
test('Отмена до запроса не касается сети или диска',async t=>{
  const file=await destination(t),controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(fetchArtifact(artifact,file,{signal:controller.signal,fetch:async()=>{calls++;return new Response(bytes);}}));
  assert.equal(calls,0);await assert.rejects(fs.lstat(file),{code:'ENOENT'});
});
test('Отмена во время потока удаляет только созданный staging',async t=>{
  const file=await destination(t),controller=new AbortController();
  await assert.rejects(fetchArtifact(artifact,file,{signal:controller.signal,fetch:async()=>new Response(new ReadableStream({start(stream){stream.enqueue(bytes);controller.abort();stream.close();}}))}));
  await assert.rejects(fs.lstat(file),{code:'ENOENT'});
});
