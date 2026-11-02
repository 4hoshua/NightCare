// A test MQTT client represents the device. This does not execute ESP32 firmware.
import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import WebSocket from 'ws';
const prefix=process.env.MQTT_PREFIX;
const url=process.env.MQTT_URL;
const origin=process.env.API_URL??'http://backend:3000';
if(!prefix||!url)throw new Error('MQTT_PREFIX and MQTT_URL required');
const base={schemaVersion:1,deviceId:'nightcare-001'};
const request='demo-request-'+Date.now();
let counter=0,sequence=0;
const state={...base,bootId:'demo-test',uptimeMs:100,mode:'AUTO',lightOn:false,brightnessPct:30,motion:false,assistanceStatus:'PENDING',requestId:request,pressCount:1,clockValid:true,appliedConfigVersion:0,droppedEvents:0,persistenceOk:true};
const device=await mqtt.connectAsync(url,{clientId:process.env.MQTT_CLIENT_ID??'nightcare-test-device',reconnectPeriod:1000,will:{topic:prefix+'availability',payload:JSON.stringify({...base,status:'offline'}),qos:1,retain:true}});
const publish=(suffix,payload,retain=false)=>device.publishAsync(prefix+suffix,JSON.stringify(payload),{qos:1,retain});
const sendState=()=>publish('state',{...state,sequence:++sequence},true);
const event=(type,id='test-event-'+(++counter))=>({...base,bootId:'demo-test',eventId:id,type,occurredAt:new Date().toISOString(),uptimeMs:100,requestId:request,pressCount:1});
const api=async(path,body)=>{const res=await fetch(origin+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
const until=async(predicate)=>{for(let i=0;i<80;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out waiting for device/backend');};
const seen=new Set();
let messageError;
device.on('message',(topic,raw)=>{void(async()=>{
 const p=JSON.parse(raw.toString());
 if(topic===prefix+'config/set'){
  Object.assign(state,{mode:p.mode,brightnessPct:p.brightnessPct,appliedConfigVersion:p.configVersion});
  await publish('acks',{...base,configVersion:p.configVersion,status:'APPLIED',reason:'OK'});await sendState();
 }else if(topic===prefix+'commands'){
  if(!seen.has(p.commandId)){
   seen.add(p.commandId);state.assistanceStatus=p.action==='ACK_HELP'?'ACKNOWLEDGED':'NONE';state.requestId=state.assistanceStatus==='NONE'?null:request;
   await publish('events',event(p.action==='ACK_HELP'?'HELP_ACKNOWLEDGED':'HELP_CLOSED'));
  }
  await publish('acks',{...base,commandId:p.commandId,requestId:request,status:'APPLIED',reason:'OK'});await sendState();
 }
})().catch(e=>{messageError=e;});});
await device.subscribeAsync([prefix+'config/set',prefix+'commands'],{qos:1});
await publish('availability',{...base,status:'online'},true);
await publish('events',event('HELP_OPENED','test-opening'));await sendState();
const heartbeat=setInterval(()=>void sendState().catch(()=>{}),15000);
if(process.argv[2]==='serve'){
 console.log('Test device ready for browser validation; this is not firmware.');
 const stop=async()=>{clearInterval(heartbeat);await publish('availability',{...base,status:'offline'},true);await device.endAsync();process.exit(0);};
 process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
}else{
 let ws;
 try{
  await until(async()=>(await api('/api/status')).data.device.online);
  assert.equal((await api('/ui-config')).data.demo,true);
  const document=await fetch(origin);assert.equal(document.status,200);assert.match(await document.text(),/NightCare/);
  ws=new WebSocket(origin.replace('http','ws')+'/ws');let snapshot;ws.on('message',r=>{snapshot=JSON.parse(r.toString()).data;});await until(()=>snapshot?.device.online);
  const original=(await api('/api/status')).data.eventCount;const duplicate=event('HELP_REITERATED','duplicate');await publish('events',duplicate);await publish('events',duplicate);
  await until(async()=>(await api('/api/status')).data.eventCount===original+1);
  const settings={mode:'ON',brightnessPct:55,offDelaySec:5,startTime:'00:00',endTime:'00:00',timezone:'America/Sao_Paulo'};
  assert.equal((await api('/api/config',{...settings,brightnessPct:0})).status,400);
  const desired=await api('/api/config',settings);assert.equal(desired.status,202);
  await until(()=>snapshot?.device.state.appliedConfigVersion===desired.data.configVersion);
  assert.equal(snapshot.device.state.brightnessPct,55);console.log('PASS demo: static dashboard, WebSocket, config confirmation and event deduplication');
  const ack={commandId:'ack-demo',requestId:request,action:'ACK_HELP'};
  assert.equal((await api('/api/commands',ack)).status,202);
  await until(()=>snapshot?.device.state.assistanceStatus==='ACKNOWLEDGED');
  assert.equal((await api('/api/commands',ack)).status,202);assert.equal(seen.size,1);
  assert.equal((await api('/api/commands',{commandId:'wrong-request',requestId:'old',action:'CLOSE_HELP'})).status,409);
  assert.equal((await api('/api/commands',{commandId:'close-demo',requestId:request,action:'CLOSE_HELP'})).status,202);
  await until(()=>snapshot?.device.state.assistanceStatus==='NONE');
  const rows=(await api('/api/events?type=HELP_CLOSED')).data;assert.equal(rows.length,1);
  state.clockValid=false;state.assistanceStatus='PENDING';state.requestId=request;await sendState();
  await until(()=>snapshot?.device.state.clockValid===false);
  assert.equal((await api('/api/commands',{...ack,commandId:'invalid-clock'})).status,409);
  await publish('availability',{...base,status:'offline'},true);await until(()=>snapshot?.device.online===false);
  await publish('availability',{...base,status:'online'},true);state.clockValid=true;await sendState();await until(()=>snapshot?.device.online===true);
  assert.ifError(messageError);console.log('PASS demo: ACK/CLOSE, idempotency, invalid request/clock and offline/recovery');
 }finally{
  clearInterval(heartbeat);ws?.terminate();
  // Remove only retained messages created under this isolated test prefix.
  for(const suffix of ['state','availability','config/set'])await device.publishAsync(prefix+suffix,'',{qos:1,retain:true});
  await device.endAsync();
 }
}
