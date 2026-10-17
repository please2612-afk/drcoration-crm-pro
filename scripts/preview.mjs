import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const indexPath=fileURLToPath(new URL('../index.html',import.meta.url));
const port=Number(process.env.YUAN_PREVIEW_PORT||4173);
const server=createServer(async(req,res)=>{
  if(req.url==='/api/workspace'){
    res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Local preview uses browser storage.'}));
    return;
  }
  if((req.url==='/'||req.url==='/index.html')&&['GET','HEAD'].includes(req.method)){
    try{const html=await readFile(indexPath);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:html);}
    catch{res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('Run npm run build before starting the preview.');}
    return;
  }
  res.writeHead(404);res.end('Not found');
});
server.listen(port,'127.0.0.1',()=>console.log('YUAN BUILD OS local preview: http://127.0.0.1:'+port));
