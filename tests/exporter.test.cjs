const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../exporter.js"), "utf8");
function harness(pages = [], saved = {}) {
  let calls = 0, blob;
  const waits = [];
  const math = Object.create(Math);
  math.random = () => 0;
  class MockURL extends URL {
    static createObjectURL(value) { blob = value; return "blob:synthetic"; }
    static revokeObjectURL() {}
  }
  const ctx = vm.createContext({
    console: {log(){}, warn(){}, error(){}},
    Math: math, URL: MockURL, URLSearchParams, TextEncoder, ReadableStream, Response,
    setTimeout(fn, ms) { waits.push(ms); fn(); },
    fetch: async () => {
      if (calls >= pages.length) throw Error("Unexpected request");
      return {ok:true, json:async()=>pages[calls++]};
    },
    document: {body:{appendChild(){}},createElement:()=>({click(){},remove(){}})}
  });
  const startLine = source.split("\n").find(line=>line.includes("starting..."));
  const stop = source.indexOf(startLine);
  assert(stop > 0);
  vm.runInContext(source.slice(0,stop) +
    'globalThis.api={RateController,retryAfterMs,fetchConversation,extractItems,listConversations,needsRefresh,exportJSONL};})();',ctx);
  const db = {transaction() {
    return {objectStore() { return {get(id) {
      const req = {};
      queueMicrotask(()=>{req.result=saved[id];req.onsuccess();});
      return req;
    }};}};
  }};
  return {api:ctx.api,waits,db,get blob(){return blob;}};
}
const page=(messages,more=false,cursor=null,id="example")=>({
  conversation_id:id,messages,page_info:{has_previous_page:more,start_cursor:cursor}
});
test("Retry-After floor survives minimum jitter", async()=>{
  const h=harness();
  await new h.api.RateController().onRateLimit({headers:{get:()=>"100"}},0);
  assert(h.waits[0]>=100000);
});
test("HTTP-date Retry-After",()=>{
  const h=harness();
  const future=new Date(Date.now()+120000).toUTCString();
  assert(h.api.retryAfterMs({headers:{get:()=>future}})>118000);
});
test("complete pages merge and identical overlap deduplicates",async()=>{
  const h=harness([page([{id:"b"}],true,"older"),page([{id:"a"},{id:"b"}])]);
  const result=await h.api.fetchConversation({},"example");
  assert.equal(JSON.stringify(result.messages),'[{"id":"a"},{"id":"b"}]');
  assert.equal(result._exporter.pages_merged,2);
});
test("missing previous cursor fails",async()=>{
  await assert.rejects(harness([page([{id:"b"}],true)]).api.fetchConversation({},"example"),/Incomplete pagination/);
});
test("repeated previous cursor fails",async()=>{
  const h=harness([page([{id:"b"}],true,"same"),page([{id:"a"}],true,"same")]);
  await assert.rejects(h.api.fetchConversation({},"example"),/Incomplete pagination/);
});
test("missing completion flag fails",async()=>{
  await assert.rejects(harness([{messages:[]}]).api.fetchConversation({},"example"),/completion evidence/);
});
test("wrong identity fails",async()=>{
  await assert.rejects(harness([page([],false,null,"wrong")]).api.fetchConversation({},"example"),/identity mismatch/);
});
test("conflicting duplicate message fails",async()=>{
  const h=harness([page([{id:"a",text:"new"}],true,"older"),page([{id:"a",text:"old"}])]);
  await assert.rejects(h.api.fetchConversation({},"example"),/Conflicting/);
});
test("unknown list shape and contradictory empty page fail",async()=>{
  const h=harness([{items:[],has_more:true}]);
  assert.throws(()=>h.api.extractItems({unexpected:[]}),/Unrecognized/);
  await assert.rejects(h.api.listConversations({},false),/Empty list/);
});
test("repeated index IDs fail",async()=>{
  const h=harness([{items:[{id:"a"}],has_more:true},{items:[{id:"a"}],has_more:true}]);
  await assert.rejects(h.api.listConversations({},false),/repeated conversation ID/);
});
test("resume recognizes dates, unknown dates, version and identity",()=>{
  const h=harness();
  const saved={conversation_id:"example",_exporter:{version:"1.0.1"},_index_update_time:"2026-01-01T00:00:00Z"};
  assert.equal(h.api.needsRefresh(saved,{id:"example",update_time:"2026-01-01T00:00:00Z"}),false);
  assert.equal(h.api.needsRefresh(saved,{id:"example",update_time:"2026-01-02T00:00:00Z"}),true);
  assert.equal(h.api.needsRefresh(saved,{id:"example",update_time:"unknown"}),true);
  assert.equal(h.api.needsRefresh(saved,{id:"wrong",update_time:saved._index_update_time}),true);
  assert.equal(h.api.needsRefresh({...saved,_exporter:{version:"1.0.0"}},{id:"example",update_time:saved._index_update_time}),true);
});
test("failed refresh excludes stale checkpoint",async()=>{
  const h=harness([],{a:{conversation_id:"a",messages:[]},b:{conversation_id:"b",messages:[]}});
  await h.api.exportJSONL(h.db,[{id:"a"},{id:"b"}],{},[{id:"a",error:"synthetic"}]);
  const lines=(await h.blob.text()).trim().split("\n").map(JSON.parse);
  assert.equal(lines.length,2);
  assert.equal(lines[1].conversation.conversation_id,"b");
});
test("database export failure rejects",async()=>{
  const h=harness();
  await assert.rejects(h.api.exportJSONL({transaction(){throw Error("synthetic db failure");}},[{id:"a"}],{},[]),/synthetic db failure/);
});
