import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import mqtt from 'mqtt';
import {checkServerIdentity} from 'node:tls';
const root=process.env.VALIDATION_DIR??'/run/validation';
const env=Object.fromEntries(readFileSync(root+'/.env','utf8').trim().split('\n').map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
const ca=readFileSync(root+'/secrets/mosquitto/ca.crt');
const password=readFileSync(root+'/Wokwi/mqtt_secrets.h','utf8').match(/#define MQTT_PASSWORD "([^"]+)"/)[1];
const prefix='nightcare/nightcare-001/';const base={schemaVersion:1,deviceId:'nightcare-001'};
const options={ca,rejectUnauthorized:true,reconnectPeriod:0,connectTimeout:3000,protocolVersion:5};
const api=async(path,body)=>{const response=await fetch('http://backend:3000/api/'+path,{headers:{Authorization:'Bearer '+env.API_TOKEN,'Content-Type':'application/json'},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});assert.ok(response.ok,`API ${path}: ${response.status} ${await (!response.ok?response.text():Promise.resolve(''))}`);return response.json();};
async function until(fn,message){for(let i=0;i<60;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error(message);}
function waitMessage(client,suffix){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{client.off('message',handler);reject(Error('missing '+suffix));},5000);const handler=(t,p,packet)=>{if(t!==prefix+suffix)return;clearTimeout(timeout);client.off('message',handler);resolve({payload:JSON.parse(p.toString()),retained:packet.retain});};client.on('message',handler);});}
if(process.argv[2]==='persistence'){
 const snapshot=await api('status');assert.equal(snapshot.commands.find(c=>c.command_id==='integration-ack').status,'APPLIED');assert.ok((await api('events?type=HELP_OPENED')).some(e=>e.event_id==='integration-event'));
 const device=await mqtt.connectAsync('mqtts://mosquitto:8883',{...options,clientId:'integration-device',username:'nightcare-001',password});
 const message=waitMessage(device,'config/set');await device.subscribeAsync(prefix+'config/set',{qos:1});assert.equal((await message).retained,true);await device.endAsync();console.log('PASS: SQLite and retained config survive backend/broker restart');process.exit(0);
}
for (const [name,override] of [['wrong hostname',{checkServerIdentity:(_,cert)=>checkServerIdentity('wrong.nightcare.test',cert),username:'nightcare-001',password}],['untrusted CA',{ca:undefined,username:'nightcare-001',password}],['anonymous',{}]]) {
 await assert.rejects(mqtt.connectAsync('mqtts://mosquitto:8883',{...options,...override,clientId:'integration-negative'}));console.log('PASS: TLS/auth rejects '+name);
}
const device=await mqtt.connectAsync('mqtts://mosquitto:8883',{...options,clientId:'integration-device',username:'nightcare-001',password,will:{topic:prefix+'availability',payload:JSON.stringify({...base,status:'offline'}),qos:1,retain:true}});
try{
 await assert.rejects(device.publishAsync(prefix+'config/set','{}',{qos:1}));
 await assert.rejects(device.publishAsync('nightcare/other/events','{}',{qos:1}));console.log('PASS: ACL denies config and other device writes');
 await device.subscribeAsync([prefix+'commands',prefix+'config/set'],{qos:1});
 const publish=(suffix,payload,retain=false)=>device.publishAsync(prefix+suffix,JSON.stringify({...base,...payload}),{qos:1,retain});
 const state={bootId:'integration-boot',sequence:1,uptimeMs:100,mode:'AUTO',lightOn:false,brightnessPct:30,motion:false,assistanceStatus:'PENDING',requestId:'integration-request',pressCount:1,clockValid:true,appliedConfigVersion:0,droppedEvents:0,persistenceOk:true};
 await publish('availability',{status:'online'},true);await publish('state',state,true);
 const event={bootId:'integration-boot',eventId:'integration-event',type:'HELP_OPENED',occurredAt:null,uptimeMs:100,requestId:'integration-request',pressCount:1};await publish('events',event);await publish('events',event);
 await until(async()=>{const s=await api('status');return s.device.online&&s.device.state?.requestId==='integration-request';},'state not received');
 const events=await api('events?type=HELP_OPENED');assert.equal(events.filter(e=>e.event_id==='integration-event').length,1);console.log('PASS: QoS1 event redelivery deduplicated in real SQLite');
 const configMessage=waitMessage(device,'config/set');const config=await api('config',{mode:'AUTO',brightnessPct:35,offDelaySec:30,startTime:'22:00',endTime:'06:00',timezone:'America/Sao_Paulo'});const receivedConfig=(await configMessage).payload;assert.equal(receivedConfig.configVersion,config.configVersion);
 await publish('acks',{configVersion:config.configVersion,status:'APPLIED',reason:'OK'});await publish('state',{...state,sequence:2,brightnessPct:35,appliedConfigVersion:config.configVersion});
 await until(async()=>(await api('status')).configs[0].status==='APPLIED','config ACK missing');console.log('PASS: API -> MQTT retained config -> device ACK -> API confirmation');
 const commandMessage=waitMessage(device,'commands');const input={commandId:'integration-ack',requestId:'integration-request',action:'ACK_HELP'};
 const command=await api('commands',input);assert.equal(command.status,'PENDING');const delivered=(await commandMessage).payload;assert.equal(Date.parse(delivered.expiresAt)-Date.parse(delivered.issuedAt),60000);
 await publish('acks',{commandId:input.commandId,requestId:input.requestId,status:'APPLIED',reason:'OK'});
 await until(async()=>(await api('commands/'+input.commandId)).status==='APPLIED','command ACK missing');
 assert.equal((await api('status')).device.state.assistanceStatus,'PENDING');
 await publish('state',{...state,sequence:3,assistanceStatus:'ACKNOWLEDGED',brightnessPct:35,appliedConfigVersion:config.configVersion});
 await publish('events',{...event,eventId:'integration-ack-event',type:'HELP_ACKNOWLEDGED'});
 assert.equal((await api('commands',input)).status,'APPLIED');console.log('PASS: command correlation, distinct confirmed state, API idempotency');
 await device.endAsync(true);await until(async()=>!(await api('status')).device.online,'will missing');console.log('PASS: Last Will marks device offline');
}finally{if(device.connected)await device.endAsync(true);}
