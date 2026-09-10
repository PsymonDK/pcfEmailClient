import fs from 'node:fs';
const SP=import.meta.dirname;
const ORG='https://your-org.crm4.dynamics.com';
const TOK=process.env.DV_TOKEN || fs.readFileSync(`${SP}/.tok`,'utf8').trim();
const CASE=process.env.DV_CASE || fs.readFileSync(`${SP}/.caseid`,'utf8').trim();
const UNAPPROVED_QUEUE='0c3bdec6-0aad-f111-aaab-000d3ab16615';   // Offensive Support, approval=2
const MAILBOX='133bdec6-0aad-f111-aaab-000d3ab16615';
const TO='anna.hansen@example.invalid';                           // RFC2606, non-routable

const api=async(p,m,b,h={})=>{const r=await fetch(`${ORG}/api/data/v9.2/${p}`,{method:m,
 headers:{Authorization:`Bearer ${TOK}`,'Content-Type':'application/json',Accept:'application/json','OData-Version':'4.0',...h},
 body:b?JSON.stringify(b):undefined});
 const t=await r.text(); let j=null; try{j=t?JSON.parse(t):null;}catch{}
 return {ok:r.ok,status:r.status,txt:t,json:j};};
const errOf=r=>String(r.json?.error?.message??r.txt??'').replace(/\s+/g,' ').slice(0,400);
const codeOf=r=>r.json?.error?.code??'(no code)';

console.log('=== mailbox state before ===');
const mb=await api(`mailboxes(${MAILBOX})?$select=name,emailaddress,outgoingemailstatus,incomingemailstatus,outgoingemaildeliverymethod`,'GET',null,{Prefer:'odata.include-annotations="*"'});
const f=k=>mb.json?.[k+'@OData.Community.Display.V1.FormattedValue']??mb.json?.[k];
console.log('  addr:',mb.json?.emailaddress,'| outgoing:',f('outgoingemailstatus'),'| method:',f('outgoingemaildeliverymethod'));

console.log('\n=== create draft FROM the unapproved queue ===');
const d=await api('emails?$select=activityid','POST',{
  subject:'S-R18 probe - unapproved queue sender (must not send)',
  description:'<p>R18 probe. Should be blocked by the approval guard.</p>',
  directioncode:true,
  'regardingobjectid_incident@odata.bind':`/incidents(${CASE})`,
  email_activity_parties:[
    {'partyid_queue@odata.bind':`/queues(${UNAPPROVED_QUEUE})`,participationtypemask:1},
    {addressused:TO,participationtypemask:2},
  ],
},{Prefer:'return=representation'});
if(!d.ok){ console.log('  draft FAILED',d.status,codeOf(d),errOf(d)); process.exit(1); }
const ID=d.json.activityid;
console.log('  draft created',ID);

console.log('\n=== SendEmail IssueSend:true ===');
const t0=Date.now();
const s=await api(`emails(${ID})/Microsoft.Dynamics.CRM.SendEmail`,'POST',{IssueSend:true});
const ms=Date.now()-t0;
if(s.ok){
  console.log(`  returned OK in ${ms}ms -> NO synchronous guard`);
} else {
  console.log(`  BLOCKED in ${ms}ms  HTTP ${s.status}  code ${codeOf(s)}`);
  console.log(`  message: ${errOf(s)}`);
}
const st=await api(`emails(${ID})?$select=statecode,statuscode`,'GET',null,{Prefer:'odata.include-annotations="*"'});
const g=k=>st.json?.[k+'@OData.Community.Display.V1.FormattedValue']??st.json?.[k];
console.log(`  post-send state: ${g('statecode')} / ${g('statuscode')}`);
fs.writeFileSync(`${SP}/r18-created.json`,JSON.stringify({id:ID},null,2));
