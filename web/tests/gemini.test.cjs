const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
function compile(file,requireFn,fetchFn){const output={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:output,require:requireFn,fetch:fetchFn,AbortSignal,Buffer,Date,Set,Error,JSON,Number});return output;}
const core=compile('src/lib/ai/claim-check.ts',require);
function adapter(fetchFn){return compile('src/lib/ai/gemini.ts',name=>name==='server-only'?{}:core,fetchFn).readReceipts;}
const input=[{id:'receipt-a',mime:'image/png',bytes:Buffer.from('fake-image')}];
const result={receipts:[{attachment_id:'receipt-a',readable:true,merchant:'Shop',amount:'20.00',currency:'MYR',date:'2026-11-21',note:''}],purpose_clear:true,purpose_note:'Workshop materials',warnings:[]};
test('Gemini sends a structured multimodal request and validates response',async()=>{
 const read=adapter(async(url,init)=>{assert.match(url,/:generateContent$/);assert.equal(init.headers['x-goog-api-key'],'test-key');const body=JSON.parse(init.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.contents[0].parts[2].inlineData.mimeType,'image/png');assert.match(body.systemInstruction.parts[0].text,/untrusted DATA/);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]});});
 assert.equal((await read('test-key','test-model','Workshop materials','Materials',input)).receipts[0].amount,'20.00');
});
test('Quota, blocked and malformed Gemini results fail without false passes',async()=>{
 const responses=[()=>new Response('',{status:429}),()=>Response.json({candidates:[{finishReason:'SAFETY'}]}),()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'not-json'}]}}]})];
 for(const response of responses)await assert.rejects(()=>adapter(async()=>response())('key','model','purpose','Materials',input));
});
