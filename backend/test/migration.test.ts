import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
test('existing SQLite adds opening time using earliest historical reception and preserves data across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nightcare-migration-')),path=join(dir,'test.sqlite');
 try{
 const db=new Database(path);db.exec(`CREATE TABLE assistance_requests(request_id TEXT PRIMARY KEY,status TEXT NOT NULL,press_count INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL);
 CREATE TABLE events(event_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,type TEXT NOT NULL,request_id TEXT,occurred_at TEXT,received_at INTEGER NOT NULL,payload TEXT NOT NULL);
 INSERT INTO assistance_requests VALUES ('active','PENDING',2,2000),('no-history','ACKNOWLEDGED',1,3000);
 INSERT INTO events VALUES ('open','nightcare-001','HELP_OPENED','active',NULL,1000,'{}');`);db.close();
 let store=new Store(path);let rows=store.snapshot().requests as any[];
 assert.equal(rows.find(r=>r.request_id==='active').opened_at,1000);assert.equal(rows.find(r=>r.request_id==='no-history').opened_at,3000);
 store.close();store=new Store(path);assert.equal(store.history({}).length,1);assert.equal(store.snapshot().requests.length,2);store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
