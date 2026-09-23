import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {exportPdf} from '../src/SabuySign.Web/Client/editor/pdf.ts';
const font=new Uint8Array(await readFile('src/SabuySign.Web/wwwroot/fonts/Sarabun-Regular.ttf'));
await mkdir('artifacts/pdf-probe',{recursive:true});
const records=[];
for(const count of [1,20,100]){
 const doc=await PDFDocument.create();const helvetica=await doc.embedFont(StandardFonts.Helvetica);
 for(let i=0;i<count;i++){const p=doc.addPage([595,842]);p.drawText('DOCUMENT / APPLICATION FORM',{x:45,y:780,size:17,font:helvetica,color:rgb(.15,.2,.25)});p.drawText(`Page ${i+1}`,{x:45,y:755,size:10,font:helvetica});for(let line=0;line<6;line++)p.drawLine({start:{x:45,y:640-line*75},end:{x:550,y:640-line*75},thickness:.5,color:rgb(.8,.83,.87)});}
 const input=await doc.save();const start=performance.now();const output=await exportPdf(input,[{id:'probe',page:0,x:45,y:130,width:500,height:110,text:'ชื่อผู้สมัคร: สมชาย Smith 123/45\nที่อยู่: กำ น้ำ ทำ น้ำ สมชาย\nผู้รับรอง: กุ้ง ปู่',size:18,color:'#172433',align:'left'}],font);
 records.push({pages:count,inputBytes:input.length,outputBytes:output.length,exportMs:Math.round(performance.now()-start)});
 await writeFile(`artifacts/pdf-probe/input-${count}.pdf`,input);await writeFile(`artifacts/pdf-probe/output-${count}.pdf`,output);
}
await writeFile('artifacts/pdf-probe/timings.json',JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,records},null,2));console.log(records);
