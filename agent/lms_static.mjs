import http from 'http'; import fs from 'fs'; import path from 'path';
// serves only absolute paths under these roots: GET /f/<abs path>
const H=process.env.HOME; const ROOTS=[H+'/.aside/u/0/sessions/',H+'/Library/CloudStorage/','/tmp/lms_sheets/'];
http.createServer((q,r)=>{ try{ const p=decodeURIComponent(new URL(q.url,'http://x').pathname.replace(/^\/f/,'')); if(!ROOTS.some(x=>p.startsWith(x))||p.includes('..')){r.writeHead(403);return r.end();}
 const ext=path.extname(p).toLowerCase(); const ct={'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png'}[ext]||'application/octet-stream';
 r.writeHead(200,{'content-type':ct}); fs.createReadStream(p).on('error',()=>r.end()).pipe(r);}catch(e){r.writeHead(500);r.end();}}).listen(5199,'127.0.0.1');
