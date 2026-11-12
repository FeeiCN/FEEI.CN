import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const {update,issueLabel,recordPath} = createRequire(import.meta.url)('../.github/actions/workflow-status/index.cjs');
function fixture(t) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-status-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const event=path.join(temp,'event.json'); fs.writeFileSync(event,JSON.stringify({sender:{login:'owner'}}));
  return {RUNNER_TEMP:temp,GITHUB_WORKSPACE:temp,GITHUB_REPOSITORY:'owner/repo',GITHUB_JOB:'sync',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_PATH:event};
}
const input=(phase='preparing',extra={})=>({phase,state:'running',token:'',...extra});
test('full lifecycle keeps phases, duration and the approved business outcome',async t=>{
 const env=fixture(t);
 await update(input(),env,undefined,new Date('2026-01-01T00:00:00Z'));
 await update(input('running'),env);
 await update(input('verifying'),env);
 await update(input('delivering',{label:'plan-ready'}),env);
 const result=await update(input('finished',{state:'success'}),env,undefined,new Date('2026-01-01T00:01:00Z'));
 assert.equal(result.duration_seconds,60);assert.equal(result.final_label,'plan-ready');
 assert.deepEqual(result.events.map(x=>x.phase),['preparing','running','verifying','delivering','finished']);
});
test('failure and cancellation override prior successful business labels; unrelated labels survive',async t=>{
 for(const state of ['failure','cancelled','skipped']) {
  const env=fixture(t);let labels=['other','codex:custom','codex:executing'];let patches=0;
  const api=async(url,options={})=>{
   if(options.method==='PATCH'){patches++; labels=JSON.parse(options.body).labels;return {ok:true};}
   return {ok:true,status:200,json:async()=>({labels})};
  };
  await update(input('delivering',{'issue-number':'873',label:'plan-ready',token:'secret'}),env,api);
  const record=await update(input('finished',{state,token:'secret'}),env,api);
  assert.deepEqual(labels,['other','codex:custom','codex:'+(state==='failure'?'failed':state)]);
  assert.equal(patches,2);assert.ok(!JSON.stringify(record).includes('secret'));
 }
});
test('denied actors, branches, pull requests and absent credentials cannot mutate labels',async t=>{
 const env=fixture(t);let count=0;
 const api=async()=>{count++;return {ok:true,json:async()=>({pull_request:{},labels:[]})};};
 assert.equal(await issueLabel('owner/repo','1','executing','',env,api),false);
 assert.equal(await issueLabel('owner/repo','1','executing','secret',{...env,GITHUB_REF:'refs/heads/other'},api),false);
 fs.writeFileSync(env.GITHUB_EVENT_PATH,JSON.stringify({sender:{login:'outsider'}}));
 assert.equal(await issueLabel('owner/repo','1','executing','secret',env,api),false);assert.equal(count,0);
 fs.writeFileSync(env.GITHUB_EVENT_PATH,JSON.stringify({sender:{login:'owner'}}));
 assert.equal(await issueLabel('owner/repo','1','executing','secret',env,api),false);assert.equal(count,1);
});
test('label creation, idempotence and API failures do not break the task',async t=>{
 const env=fixture(t);const calls=[];
 const api=async(url,options={})=>{calls.push(options.method||'GET');
  if(url.endsWith('/issues/1'))return {ok:true,json:async()=>({labels:[]})};
  if(url.includes('/labels/'))return {ok:false,status:404};
  return {ok:true};
 };
 await issueLabel('owner/repo','1','cancelled','secret',env,api);
 assert.deepEqual(calls,['GET','GET','POST','PATCH']);
 let count=0;await issueLabel('owner/repo','1','done','secret',env,async()=>{count++;return {ok:true,json:async()=>({labels:['codex:done','other']})};});assert.equal(count,1);
 const record=await update(input('running',{'issue-number':'1',label:'executing',token:'secret'}),env,async()=>{throw Error('secret body');});
 assert.equal(record.label_updated,false);assert.equal(record.state,'running');assert.ok(!JSON.stringify(record).includes('secret'));
});
test('result and source receipts contain only allowed status fields and matrix tasks stay separate',async t=>{
 const env=fixture(t);fs.writeFileSync(path.join(env.RUNNER_TEMP,'result.json'),'{"status":"no_update"}');
 fs.writeFileSync(path.join(env.RUNNER_TEMP,'sources.json'),JSON.stringify({vendors:[{vendor:'vendor_a',status:'failed',reason:'secret'},{vendor:'unsafe\n',status:'failed'}]}));
 const record=await update(input('finished',{state:'success','result-file':'result.json','details-file':'sources.json'}),env);
 assert.equal(record.state,'no_update');assert.deepEqual(record.sources,[{source:'vendor_a',state:'failed'}]);
 assert.notEqual(recordPath(env,'health'),recordPath(env,'assets'));
});
test('invalid environment fails open without leaking arguments',t=>{
 const env=fixture(t);
 const run=spawnSync(process.execPath,['.github/actions/workflow-status/index.cjs','--phase','secret-invalid'],{env:{...process.env,...env},encoding:'utf8'});
 assert.equal(run.status,0);assert.match(run.stdout,/warning/);assert.ok(!run.stdout.includes('secret-invalid'));
});
test('the copied CLI survives checkout changes and continues the same receipt',t=>{
 const env={...process.env,...fixture(t),GITHUB_ACTIONS:'true'};
 env.GITHUB_ENV=path.join(env.RUNNER_TEMP,'env');
 let result=spawnSync(process.execPath,['.github/actions/workflow-status/index.cjs','--task','health'],{env,encoding:'utf8'});
 assert.equal(result.status,0);
 Object.assign(env,Object.fromEntries(fs.readFileSync(env.GITHUB_ENV,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];})));
 result=spawnSync(env.WORKFLOW_STATUS_NODE,[env.WORKFLOW_STATUS_SCRIPT,'--phase','finished','--state','cancelled'],{env,encoding:'utf8'});
 assert.equal(result.status,0);
 const record=JSON.parse(fs.readFileSync(recordPath(env)));
 assert.equal(record.task,'health');assert.equal(record.state,'cancelled');assert.equal(record.events.length,2);
});
