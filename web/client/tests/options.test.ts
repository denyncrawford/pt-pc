import {test,expect} from 'bun:test';
import {parseOptions,defaultOptions,brightnessIndex} from '../options.js';
test('stored settings reject wrong types and non-finite numeric values',()=>{
 expect(parseOptions(null)).toEqual(defaultOptions);
 expect(parseOptions({volume:NaN,sensitivity:Infinity,invertY:'true',language:'<script>'})).toEqual(defaultOptions);
 expect(parseOptions({volume:5,sensitivity:-8,brightness:0,renderScale:.1,invertX:true})).toEqual({...defaultOptions,volume:1,sensitivity:.2,brightness:.48,invertX:true});
});
test('native brightness indices preserve endpoints and the original default',()=>{
 expect(brightnessIndex(.48)).toBe(0);expect(brightnessIndex(1)).toBe(7);expect(brightnessIndex(1.13)).toBe(10);
});
