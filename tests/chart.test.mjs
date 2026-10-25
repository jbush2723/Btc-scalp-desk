import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeChart} from '../chart.js';
const now=100000;
const history=direction=>Array.from({length:20},(_,i)=>({at:now-38000+i*2000,mid:.5+direction*i*.002}));
test('chart detects rising, falling and flat midpoint trends with fast/slow lines',()=>{
  const up=analyzeChart(history(1),now);assert.equal(up.ready,true);assert.equal(up.direction,'UP');assert.ok(up.fast>up.slow);assert.ok(up.low<up.high);
  assert.equal(analyzeChart(history(-1),now).direction,'DOWN');assert.equal(analyzeChart(history(0),now).direction,'MIXED / FLAT');
});
test('chart refuses stale, short or interrupted history',()=>{
  assert.equal(analyzeChart(history(1),now+7000).direction,'STALE');
  assert.equal(analyzeChart(history(1).slice(-4),now).ready,false);
  assert.equal(analyzeChart([...history(1).slice(0,3),...history(1).slice(10)],now).ready,false);
});
