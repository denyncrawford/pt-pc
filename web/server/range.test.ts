import {test,expect} from 'bun:test';
import {byteRange} from './range';
test('HTTP byte ranges: bounded, open ended and suffix',()=>{
 expect(byteRange(null,100)).toBeNull();
 expect(byteRange('bytes=0-31',100)).toEqual([0,31]);
 expect(byteRange('bytes=80-',100)).toEqual([80,99]);
 expect(byteRange('bytes=-8',100)).toEqual([92,99]);
 expect(byteRange('bytes=90-200',100)).toEqual([90,99]);
 for(const value of ['bytes=100-','bytes=5-2','bytes=-0','bytes=','bytes=1-2,3-4','bytes=9007199254740992-'])expect(()=>byteRange(value,100)).toThrow();
});
