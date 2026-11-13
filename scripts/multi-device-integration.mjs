// Two MQTT clients represent devices. This script does not execute ESP32 firmware.
import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import WebSocket from 'ws';
const url=process.env.MQTT_URL,root=(process.env.MQTT_PREFIX??'').replace(/nightcare-001\/$/,'');
const origin=process.env.API_URL??'http://backend:3000';
if(!url||!root)throw Error('MQTT_URL and MQTT_PREFIX required');
const ids=['nightcare-001','nightcare-002'],clients=[];
const api=async(path,body)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};};
const until=async(fn)=>{for(let n=0;n<100;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('multi-device timeout');};
let error;
for(const [index,id] of ids.entries()){
 const prefix=root+id+'/',base={schemaVersion:1,deviceId:id};
 const state={...base,bootId:'multi-'+Date.now(),sequence:0,uptimeMs:100,mode:'AUTO',brightnessPct:30,lightOn:index===0,motion:index===0,assistanceStatus:'PENDING',requestId:'multi-request',pressCount:1,clockValid:true,appliedConfigVersion:0,droppedEvents:0,persistenceOk:true};
 const client=await mqtt.connectAsync(url,{clientId:'multi-device-'+id,reconnectPeriod:0,will:{topic:prefix+'availability',payload:JSON.stringify({...base,status:'offline'}),qos:1,retain:true}});
 const publish=(topic,payload,retain=false)=>client.publishAsync(prefix+topic,JSON.stringify(payload),{qos:1,retain});
 const sendState=()=>publish('state',{...state,sequence:++state.sequence},true);
 const seen=new Set();let counter=0;
 const event=type=>publish('events',{...base,bootId:state.bootId,eventId:'multi-event-'+(++counter),type,requestId:'multi-request',pressCount:state.pressCount,uptimeMs:100,occurredAt:new Date().toISOString()});
 client.on('message',(topic,raw)=>{void(async()=>{
   const p=JSON.parse(raw.toString());assert.equal(p.deviceId,id);
   if(topic===prefix+'config/set'){
     Object.assign(state,{mode:p.mode,brightnessPct:p.brightnessPct,appliedConfigVersion:p.configVersion,runtimeSettings:{offDelaySec:p.offDelaySec,startTime:p.startTime,endTime:p.endTime,timezoneOffsetHours:-3}});
     await publish('acks',{...base,configVersion:p.configVersion,status:'APPLIED',reason:'OK'});await sendState();
   }else if(topic===prefix+'commands'){
     if(!seen.has(p.commandId)){seen.add(p.commandId);state.assistanceStatus=p.action==='ACK_HELP'?'ACKNOWLEDGED':'NONE';state.requestId=state.assistanceStatus==='NONE'?null:'multi-request';if(state.assistanceStatus==='NONE')state.pressCount=0;await event(p.action==='ACK_HELP'?'HELP_ACKNOWLEDGED':'HELP_CLOSED');}
     await publish('acks',{...base,commandId:p.commandId,requestId:p.requestId,status:'APPLIED',reason:'OK'});await sendState();
   }
 })().catch(e=>{error=e;});});
 await client.subscribeAsync([prefix+'config/set',prefix+'commands'],{qos:1});
 await publish('availability',{...base,status:'online'},true);await event('HELP_OPENED');await sendState();
 const heartbeat=setInterval(()=>void sendState().catch(()=>{}),15000);
 clients.push({client,state,publish,sendState,seen,heartbeat,prefix});
}
if(process.argv[2]==='serve'){
 console.log('Two isolated MQTT test devices ready; no firmware is executing.');
 process.on('SIGTERM',()=>{void Promise.all(clients.map(async d=>{clearInterval(d.heartbeat);await d.publish('availability',{schemaVersion:1,deviceId:d.state.deviceId,status:'offline'},true);await d.client.endAsync();})).then(()=>process.exit(0));});
}else{
 let ws;
 try{
   await until(async()=>{const {data}=await api('/api/devices');return ids.every(id=>data.find(d=>d.deviceId===id)?.online);});
   const devices=(await api('/api/devices')).data;
   for(const [n,id] of ids.entries())if(!devices.find(d=>d.deviceId===id).bed)assert.equal((await api(`/api/devices/${id}/assign`,{name:`Leito ${n+1}`})).status,201);
   ws=new WebSocket(origin.replace('http','ws')+'/ws');let snapshot;ws.on('message',raw=>{snapshot=JSON.parse(raw).data;});
   await until(()=>snapshot?.devices.length===2&&snapshot.beds.length===2);
   assert.equal(snapshot.snapshots[ids[0]].device.state.motion,true);assert.equal(snapshot.snapshots[ids[1]].device.state.motion,false);
   for(const id of ids){const rows=(await api(`/api/devices/${id}/events?type=HELP_OPENED`)).data;assert.ok(rows.some(r=>r.event_id==='multi-event-1'));}
   assert.equal((await api('/api/config',{mode:'AUTO',brightnessPct:40,offDelaySec:30,startTime:'22:00',endTime:'06:00',timezone:'America/Sao_Paulo'})).data.error,'DEVICE_REQUIRED');
   const settings={mode:'AUTO',brightnessPct:65,offDelaySec:5,startTime:'00:00',endTime:'00:00',timezone:'America/Sao_Paulo'};
   const first=await api(`/api/devices/${ids[0]}/config`,settings);assert.equal(first.status,202);
   await until(()=>snapshot.snapshots[ids[0]].device.state.brightnessPct===65);
   assert.equal(snapshot.snapshots[ids[1]].device.state.brightnessPct,30);
   const command={commandId:'multi-ack',requestId:'multi-request',action:'ACK_HELP'};
   assert.equal((await api(`/api/devices/${ids[0]}/commands`,command)).status,202);
   await until(()=>snapshot.snapshots[ids[0]].device.state.assistanceStatus==='ACKNOWLEDGED');
   assert.equal(snapshot.snapshots[ids[1]].device.state.assistanceStatus,'PENDING');
   assert.equal((await api(`/api/devices/${ids[1]}/commands/multi-ack`)).status,404);
   assert.equal((await api(`/api/devices/${ids[1]}/commands`,command)).status,202);
   await until(()=>snapshot.snapshots[ids[1]].device.state.assistanceStatus==='ACKNOWLEDGED');
   assert.equal((await api(`/api/devices/${ids[0]}/commands`,{...command,commandId:'multi-close',action:'CLOSE_HELP'})).status,202);
   await until(()=>snapshot.snapshots[ids[0]].device.state.assistanceStatus==='NONE');
   assert.equal(snapshot.snapshots[ids[1]].device.state.assistanceStatus,'ACKNOWLEDGED');
   await clients[0].client.endAsync(true);clearInterval(clients[0].heartbeat);
   await until(()=>!snapshot.snapshots[ids[0]].device.online);assert.equal(snapshot.snapshots[ids[1]].device.online,true);
   const all=(await api('/api/events?scope=all&limit=1')).data;assert.equal(all.items.length,1);assert.ok(all.nextCursor);
   assert.equal((await api(`/api/devices/${ids[1]}/events?cursor=${all.nextCursor}`)).status,400);
   const notifications=(await api('/api/notifications?limit=100')).data;
   assert.ok(notifications.installationId);
   assert.equal(notifications.items.filter(n=>n.type==='HELP_OPENED'&&n.reference==='multi-request').length,2);
   assert.ok(notifications.items.some(n=>n.deviceId===ids[0]&&n.type==='CONFIG_APPLIED'));
   assert.ok(notifications.items.some(n=>n.deviceId===ids[0]&&n.type==='HELP_CLOSED'));
   assert.ok(notifications.items.some(n=>n.deviceId===ids[0]&&n.type==='DEVICE_OFFLINE'));
   assert.ok(notifications.items.some(n=>n.deviceId===ids[1]&&n.type==='COMMAND_APPLIED'));
   const read=(await api(`/api/notifications?readThroughId=${notifications.latestId}&category=assistance`)).data;
   assert.equal(read.unreadCount,0);
   await until(()=>snapshot.notifications.latestId>=notifications.latestId);
   assert.equal(snapshot.notifications.installationId,notifications.installationId);
   const lighting=(await api(`/api/devices/${ids[0]}/lighting-analytics?period=7d`)).data;
   assert.equal(lighting.deviceId,ids[0]);assert.equal(lighting.period,'7d');assert.equal(lighting.hourlyMovements.length,24);
   assert.equal(lighting.agendaReference.startTime,'00:00');assert.equal(lighting.agendaReference.endTime,'00:00');
   assert.equal(lighting.agendaReference.source,'telemetry');assert.equal(lighting.timezoneOffsetHours,-3);
   assert.equal((await api(`/api/devices/${ids[0]}/lighting-analytics?period=invalid`)).status,400);
   assert.ifError(error);console.log('PASS multi: discovery/association, separate motion/config, simultaneous calls, scoped ACK/CLOSE, global history and one-device Last Will; persistent notifications, lighting analytics and WebSocket metadata');
 }finally{
   ws?.terminate();for(const d of clients){clearInterval(d.heartbeat);if(d.client.connected){for(const suffix of ['state','availability','config/set'])await d.client.publishAsync(d.prefix+suffix,'',{qos:1,retain:true});await d.client.endAsync();}}
 }
}
