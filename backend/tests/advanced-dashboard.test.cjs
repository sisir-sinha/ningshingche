'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) { JSDOM = null; }
const code = fs.readFileSync(path.join(__dirname,'../assets/js/reports.js'),'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve,10));

test('account and policy panels send confirmed reasoned decisions to their RPCs', {skip: !JSDOM}, async () => {
  const dom = new JSDOM('<main id="root"></main>',{url:'https://example.test',runScripts:'outside-only'});
  const w=dom.window, calls=[], toasts=[];
  const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  class ListState {
    constructor(){this.records=[];this.query='';} setFilter(){} setQuery(x){this.query=x;} setRecords(x){this.records=x;}
    paged(){return {rows:[],total:0};}
  }
  w.confirm=()=>true;
  w.NC={views:{},auth:{canAccess:()=>false},
    utils:{escapeHTML,formatDateTime:x=>x||'',debounce:f=>f},
    crud:{ListState,bindPagination(){},bindSort(){},isStaleNavigation:()=>false,handleLoadError(){throw new Error('load error');}},
    components:{pageHeader:()=>'',skeleton:()=>'',emptyState:()=>'',toast:(...x)=>toasts.push(x)},
    api:{list:async()=>({data:[]}),userMessage:e=>e.message,rpc:async (name,args)=>{
      calls.push([name,args]);
      if(name==='moderation_policy_catalog') return [{code:'spam',label:'Spam',description:'Description',severity:'low',content_types:['article'],recommended_action:'review',appeal_eligible:true}];
      if(name==='dashboard_list_moderation_appeals') return [];
      if(name==='dashboard_account_action') return {id:'recorded'};
      return {};
    }}
  };
  w.eval(code);
  const root=w.document.querySelector('#root');
  await w.NC.views.reports.render(root,{params:new w.URLSearchParams()});
  const panel=root.querySelector('[data-account-moderation]'), form=panel.querySelector('[data-account-form]');
  form.elements.user_id.value='22222222-2222-2222-2222-222222222222';
  form.elements.reason.value='A clear reason';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  const action=calls.find(([name])=>name==='dashboard_account_action');
  assert.equal(action[1].p_action,'warning');
  assert.equal(action[1].p_reason,'A clear reason');
  assert.ok(action[1].p_request_id);
  const settings=root.querySelector('[data-policy-settings]');
  settings.open=true; settings.dispatchEvent(new w.Event('toggle')); await tick();
  const policy=settings.querySelector('[data-policy-form]');
  assert.equal(policy.elements.description.value,'Description');
  policy.elements.reason.value='A policy clarification';
  policy.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await tick();
  const change=calls.find(([name])=>name==='dashboard_update_moderation_policy');
  assert.equal(change[1].p_code,'spam');
  assert.deepEqual([...change[1].p_content_types],['article']);
  assert.equal(change[1].p_reason,'A policy clarification');
  assert.equal(toasts.some(x=>x[1]==='error'),false);
  dom.window.close();
});
