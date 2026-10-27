// Regression oracle captured before the live-session refactor. No second engine.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {simulate}=require('../sim-core.js');
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/finite-core-0.3.0.json',import.meta.url),'utf8'));
for(const c of fixtures.cases){
  test(`finite compatibility: ${c.name}`,()=>{
    assert.deepEqual(simulate(c.workload,c.config),c.expected);
  });
}
