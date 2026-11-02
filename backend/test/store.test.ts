import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { PREFIX, DEVICE, settingsSchema } from '../src/contracts.js';
const settings={mode:'AUTO' as const,brightnessPct:30,offDelaySec:30,startTime:'22:00',endTime:'06:00',timezone:'America/Sao_Paulo' as const};
const state={schemaVersion:1,deviceId:DEVICE,bootId:'boot-a',sequence:1,uptimeMs:100,mode:'AUTO',lightOn:false,brightnessPct:30,motion:false,assistanceStatus:'PENDING',requestId:'request-a',pressCount:1,clockValid:true,appliedConfigVersion:0,droppedEvents:0,persistenceOk:true};
const event={schemaVersion:1,deviceId:DEVICE,bootId:'boot-a',eventId:'event-a',type:'HELP_OPENED',occurredAt:null,uptimeMs:20,requestId:'request-a',pressCount:1};
function ingest(s:Store,topic:string,payload:unknown,retained=false){s.ingest(PREFIX+topic,Buffer.from(JSON.stringify(payload)),retained);}
test('event redelivery is deduplicated and cannot regress closed requests',()=>{
 const s=new Store(':memory:');try{ingest(s,'events',event);ingest(s,'events',event);assert.equal(s.history({}).length,1);
 ingest(s,'events',{...event,eventId:'close',type:'HELP_CLOSED'});ingest(s,'events',{...event,eventId:'late',type:'HELP_REITERATED',pressCount:3});
 assert.equal((s.snapshot().requests[0] as any).status,'CLOSED');assert.equal((s.snapshot().requests[0] as any).press_count,3);
 assert.throws(()=>ingest(s,'events',{...event,schemaVersion:2}));assert.throws(()=>ingest(s,'events',event,true));assert.equal(s.history({}).length,3);
 }finally{s.close();}
});
test('retained state does not establish liveness; heartbeat expires after 45s',()=>{
 let now=100000;const s=new Store(':memory:',()=>now);try{ingest(s,'state',state,true);assert.equal(s.device().online,false);
 ingest(s,'availability',{schemaVersion:1,deviceId:DEVICE,status:'online'},true);assert.equal(s.device().online,false);
 ingest(s,'state',{...state,sequence:2});assert.equal(s.device().online,true);now+=45000;assert.equal(s.device().online,false);
 ingest(s,'state',{...state,sequence:1});assert.equal(s.device().state.sequence,2);
 ingest(s,'state',{...state,sequence:3});ingest(s,'availability',{schemaVersion:1,deviceId:DEVICE,status:'offline'});assert.equal(s.device().online,false);
 }finally{s.close();}
});
test('configurations are atomic, monotonic, durable desired intent and application confirmation',async()=>{
 const s=new Store(':memory:');try{let sent:any[]=[];s.publish=async(...args)=>{sent.push(args);};
 assert.throws(()=>settingsSchema.parse({...settings,brightnessPct:0}));assert.equal(s.configs().length,0);
 const one=await s.setConfig(settings);const two=await s.setConfig({...settings,mode:'OFF'});assert.equal(one.configVersion,1);assert.equal(two.configVersion,2);assert.equal(sent[0][2],true);
 ingest(s,'acks',{schemaVersion:1,deviceId:DEVICE,configVersion:1,status:'APPLIED',reason:'OK'});assert.equal(s.configs()[1].status,'APPLIED');
 ingest(s,'state',{...state,appliedConfigVersion:12});assert.equal((await s.setConfig(settings)).configVersion,13);
 }finally{s.close();}
});
test('commands correlate ACK, reject mismatched IDs, timeout at 10s, replay only before expiry',async()=>{
 let now=1700000000000;const s=new Store(':memory:',()=>now);try{ingest(s,'state',state);const sent:any[]=[];s.publish=async(...a)=>{sent.push(a);};
 const c={commandId:'cmd-a',requestId:'request-a',action:'ACK_HELP' as const};const first=await s.command(c);assert.equal(first.status,'PENDING');
 assert.equal((await s.command(c)).command_id,'cmd-a');assert.equal(sent.length,1);
 await assert.rejects(s.command({...c,requestId:'other'}),/ID_CONFLICT/);
 await assert.rejects(s.command({...c,commandId:'bad',requestId:'other'}),/REQUEST_MISMATCH/);
 await assert.rejects(s.command({...c,commandId:'close',action:'CLOSE_HELP'}),/INVALID_TRANSITION/);
 assert.throws(()=>ingest(s,'acks',{schemaVersion:1,deviceId:DEVICE,commandId:'cmd-a',requestId:'wrong',status:'APPLIED',reason:'OK'}),/uncorrelated/);
 now+=10000;s.tick();assert.equal(s.getCommand('cmd-a').status,'UNCONFIRMED');await s.replay();assert.equal(sent.length,2);
 now+=50001;await s.replay();assert.equal(sent.length,2);
 ingest(s,'acks',{schemaVersion:1,deviceId:DEVICE,commandId:'cmd-a',requestId:'request-a',status:'APPLIED',reason:'OK'});assert.equal(s.getCommand('cmd-a').status,'APPLIED');assert.equal(s.device().state.assistanceStatus,'PENDING');
 }finally{s.close();}
});
test('API auth, input bounds, conflict and accepted status; health separates broker readiness',async()=>{
 const s=new Store(':memory:');const token='a'.repeat(64);const app=await buildApp(s,token);try{
 assert.equal((await app.inject('/health/live')).statusCode,200);assert.equal((await app.inject('/health/ready')).statusCode,503);
 assert.equal((await app.inject('/api/status')).statusCode,401);
 const headers={authorization:'Bearer '+token};assert.equal((await app.inject({url:'/api/status',headers})).statusCode,200);
 assert.equal((await app.inject({url:'/api/events?limit=999999',headers})).statusCode,400);
 assert.equal((await app.inject({url:'/api/config',method:'POST',headers,payload:{...settings,startTime:'25:00'}})).statusCode,400);
 const config=await app.inject({url:'/api/config',method:'POST',headers,payload:settings});assert.equal(config.statusCode,202);assert.equal(config.json().configVersion,1);
 const cmd=await app.inject({url:'/api/commands',method:'POST',headers,payload:{commandId:'a',requestId:'b',action:'ACK_HELP'}});assert.equal(cmd.statusCode,409);
 assert.equal((await app.inject({url:'/api/commands/missing',headers})).statusCode,404);
 }finally{await app.close();s.close();}
});
