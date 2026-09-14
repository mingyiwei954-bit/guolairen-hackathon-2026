const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const app = read('public/app.js');
const context = vm.createContext({});
vm.runInContext(read('public/screen-replicas.js') + read('public/mock-library.js') + app.slice(app.indexOf('const DEMO_CHANNELS ='), app.indexOf('const KANSHAN_SUGGESTIONS =')), context);
let total = 0;
for (const channel of ['recommend', 'hot', 'follow', 'story', 'knowledge']) {
 const result = vm.runInContext(`(() => {
  const pool = mockPool('${channel}');
  const first = mockItems('${channel}');
  const next = nextMockBatch('${channel}');
  return {count:pool.length, unique:new Set(pool.map(x=>x.id)).size,
   first:first[0].id, next:next[0].id, size:next.length,
   retained:mockItems('${channel}')===next,
   marked:pool.every(x=>x.is_demo && x.source_kind),
   valid:pool.every(x=>typeof x.title==='string' && x.title.length>0)};
 })()`, context);
 assert.equal(result.count, result.unique);
 assert.notEqual(result.first, result.next);
 assert.equal(result.size, 12);
 assert(result.retained && result.marked && result.valid);
 total += result.count;
}
assert.equal(total, 121);
const other = vm.runInContext(`(() => {const saved=mockItems('story');nextMockBatch('recommend');return saved===mockItems('story')})()`, context);
assert(other, 'Refreshing one channel must not reset another channel');
console.log('121 records: unique IDs, labels, batch rotation, retained selection and channel isolation passed.');
