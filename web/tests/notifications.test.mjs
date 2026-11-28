import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function load(file, imports) {
  const m = new Module(path.resolve(file)); m.filename = path.resolve(file); m.paths = require.resolve.paths("typescript");
  m.require = name => Object.hasOwn(imports,name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(await readFile(file,"utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,m.filename);
  return m.exports;
}
const id = "11111111-1111-4111-8111-111111111111";
test("Only committed approvals/payments request delivery; mail outages preserve financial success", async () => {
  let error=null, failFetch=false; const calls=[];
  const {rpc} = await load("src/lib/api.ts",{
    "./domain":{}, "./supabase/client":{createClient:()=>({rpc:async()=>({data:"result",error})})},
    "./browser-fetch":{browserFetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]); if(failFetch) throw new Error("offline"); return new Response(null,{status:202});}},
  });
  await rpc("ml_review_claim",{p_claim_id:id,p_decision:"rejected"}); assert.equal(calls.length,0);
  assert.equal(await rpc("ml_review_claim",{p_claim_id:id,p_decision:"approved"}),"result");
  assert.deepEqual(calls[0],["/api/notifications/dispatch",{claimId:id}]);
  failFetch=true; assert.equal(await rpc("ml_record_payment",{p_claim_id:id}),"result");
  error=new Error("Budget exhausted");
  await assert.rejects(rpc("ml_review_claim",{p_claim_id:id,p_decision:"approved"}),/Budget exhausted/);
  assert.equal(calls.length,2);
});
test("Notification transport uses the confirmed claimant, safe content and durable failure handling", async () => {
  const saved = { ...process.env };
  Object.assign(process.env,{ GMAIL_USER:"club@gmail.com", GMAIL_APP_PASSWORD:"test-secret", APP_URL:"https://moneylai.example", NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY:"service" });
  const item = { id, claim_id:id,recipient_id:"claimant",lease_token:"lease",kind:"approved",payload:{claim_number:"ML-000001",amount:25,activity:"<Club>",paid_on:"2026-11-26",reference:"REF-1"} };
  let sendError = false, confirmed = true, mail, lease = true;
  const calls = [];
  const admin = {
    rpc:async (name,args)=> { calls.push([name,args]); return {data:name === "ml_take_claim_email" && lease ? [item] : []}; },
    auth:{admin:{getUserById:async who=>{ assert.equal(who,"claimant"); return {data:{user:{email:"member@example.com",email_confirmed_at:confirmed?"2026-11-26":null}}}; }}},
    from:()=>({select:()=>({eq(){return this;},maybeSingle:async()=>({data:{id}})})}),
  };
  try {
    const { dispatchClaimEmails,notificationText } = await load("src/lib/notifications/email.ts",{
      "server-only":{}, "@supabase/supabase-js":{createClient:()=>admin},
      nodemailer:{createTransport:options=>{ assert.equal(options.secure,true); return {sendMail:async message=>{mail=message; if(sendError) throw new Error("PRIVATE secret"); return {accepted:["member@example.com"]}; }}; }},
    });
    assert.equal((await dispatchClaimEmails(id)).sent,1);
    assert.equal(mail.to,"member@example.com"); assert.match(mail.text,/awaiting payment/);
    assert.match(mail.text,/https:\/\/moneylai.example\/claims\//);
    assert.equal(mail.html,undefined);
    item.kind="paid";
    const paid = notificationText(item,"https://moneylai.example");
    assert.match(paid.text,/Treasurer has recorded/); assert.match(paid.text,/REF-1/); assert.doesNotMatch(paid.text,/awaiting payment/);
    sendError=true;
    assert.equal((await dispatchClaimEmails(id)).failed,1);
    assert.equal(calls.at(-1)[1].p_success,false);
    sendError=false; confirmed=false; mail=null;
    assert.equal((await dispatchClaimEmails(id)).failed,1); assert.equal(mail,null);
    delete process.env.GMAIL_APP_PASSWORD;
    const before = calls.length;
    assert.equal((await dispatchClaimEmails(id)).configured,false); assert.equal(calls.length,before);
    process.env.GMAIL_APP_PASSWORD="test"; lease=false;
    assert.equal((await dispatchClaimEmails(id)).sent,0);
  } finally { process.env = saved; }
});

test("Dispatch endpoints require cron credentials or an active same-origin Treasurer", async () => {
  const saved = process.env.CRON_SECRET; process.env.CRON_SECRET="cron-test";
  let role="treasurer", status="active", authenticated=true, calls=0; const tasks=[];
  const {GET,POST} = await load("src/app/api/notifications/dispatch/route.ts",{
    "next/server":{after:fn=>tasks.push(fn)},
    "@/lib/notifications/email":{dispatchClaimEmails:async()=>{calls++; return {configured:true,sent:1};}},
    "@/lib/members/server":{
      memberId:value=>value===id,memberJson:(data,status=200)=>Response.json(data,{status}),
      sameOrigin:r=>r.headers.get("origin")===new URL(r.url).origin,
      memberSession:async()=>({user:authenticated?{id}:null,client:{from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,account_status:status}})})})})}}),
    },
  });
  const request=(origin="https://moneylai.example",body={claimId:id,to:"attacker@example.com"})=>new Request("https://moneylai.example/api/notifications/dispatch",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
  try {
    assert.equal((await GET(new Request("https://moneylai.example"))).status,401);
    assert.equal((await GET(new Request("https://moneylai.example",{headers:{authorization:"Bearer cron-test"}}))).status,200);
    assert.equal((await POST(request("https://evil.example"))).status,403);
    authenticated=false; assert.equal((await POST(request())).status,401); authenticated=true;
    for (const value of ["member","president"]) {role=value; assert.equal((await POST(request())).status,403);}
    role="treasurer"; status="disabled"; assert.equal((await POST(request())).status,403); status="active";
    assert.equal((await POST(request(undefined,{claimId:"bad"}))).status,400);
    assert.equal((await POST(request())).status,202); assert.equal(tasks.length,1);
    await tasks[0](); assert.equal(calls,2);
  } finally { if(saved===undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=saved; }
});
