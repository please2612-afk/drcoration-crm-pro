import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
import handler from '../worker/index.js';

const port=Number(process.env.YUAN_DEV_PORT||4174);
const directory=resolve(process.env.YUAN_DEV_DATA_DIR||'.yuan-dev');
await mkdir(directory,{recursive:true});
const db=new DatabaseSync(resolve(directory,'workspace.sqlite'));
if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get())db.exec(await readFile(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
db.exec('CREATE TABLE IF NOT EXISTS local_assets (key TEXT PRIMARY KEY, body BLOB NOT NULL, metadata TEXT NOT NULL)');
const env={
 DB:{prepare(sql){const statement=db.prepare(sql);let args=[];const query={bind(...values){args=values;return query;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){const result=statement.run(...args);return {meta:{changes:Number(result.changes)}};}};return query;}},
 BUCKET:{async put(key,bytes,metadata){db.prepare('INSERT OR REPLACE INTO local_assets VALUES (?, ?, ?)').run(key,bytes,JSON.stringify(metadata));},async get(key){const row=db.prepare('SELECT * FROM local_assets WHERE key=?').get(key);return row?{body:row.body,...JSON.parse(row.metadata)}:null;}},
 AI_BASE_URL:process.env.AI_BASE_URL,AI_MODEL:process.env.AI_MODEL,AI_API_KEY:process.env.AI_API_KEY
};
const server=createServer(async(req,res)=>{
 try{
  // This server is for loopback development only. It never trusts caller identity headers.
  const host=req.headers.host,allowed=['127.0.0.1:'+port,'localhost:'+port];
  if(!allowed.includes(host)||(req.headers.origin&&req.headers.origin!=='http://'+host)){res.writeHead(403);res.end('Local development access only');return;}
  const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(typeof value==='string')headers.set(name,value);
  headers.set('oai-authenticated-user-id','local-development-owner');headers.set('oai-authenticated-user-email','dev-owner@localhost.invalid');
  const request=new Request('http://'+host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
  const response=await handler.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
 }catch{if(!res.headersSent)res.writeHead(500);res.end('Local development server error');}
});
server.listen(port,'127.0.0.1',()=>console.log('YUAN full API development server running on loopback port '+port+' (local development identity).'));
function shutdown(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
