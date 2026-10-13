// Static FMDL geometry subset, based on tools/fmdl.py and engine/assets/fmdl.cpp.
// Original project and this prototype are MIT licensed. No game assets included.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <emscripten/emscripten.h>
static const uint8_t *data;
static uint32_t length, bad, raw_offset, raw_size;
static float *vertices, *uvs, *tangents;
static uint32_t *indices, nv, ni;
typedef struct { uint32_t offset, count; } Table;
static Table tables[256];
static uint32_t readn(uint64_t p, unsigned n) {
    if (p + n > length) { bad = 1; return 0; }
    uint32_t v=0; for(unsigned i=0;i<n;i++) v |= (uint32_t)data[p+i] << (8*i);
    return v;
}
static float component(uint64_t p, unsigned format, unsigned c) {
    if(format==1) { uint32_t v=readn(p+c*4,4); float f; memcpy(&f,&v,4); return f; }
    if(format==6 || format==7) {
        uint32_t h=readn(p+c*2,2), e=(h>>10)&31, m=h&1023;
        float f=e==0 ? ldexpf((float)m,-24) : e==31 ? NAN : ldexpf((float)(1024+m),(int)e-25);
        return h&32768 ? -f : f;
    }
    bad=1; return 0;
}
EMSCRIPTEN_KEEPALIVE void release_geometry(void) {
    free(vertices); free(indices); free(uvs); free(tangents); tangents=0; uvs=0; vertices=0; indices=0; nv=ni=0;
}
EMSCRIPTEN_KEEPALIVE uint32_t raw_position_ptr(void) { return (uintptr_t)(data+raw_offset); }
EMSCRIPTEN_KEEPALIVE uint32_t raw_position_count(void) { return raw_size/12; }
EMSCRIPTEN_KEEPALIVE uint32_t vertex_ptr(void) { return (uintptr_t)vertices; }
EMSCRIPTEN_KEEPALIVE uint32_t tangent_ptr(void) { return (uintptr_t)tangents; }
EMSCRIPTEN_KEEPALIVE uint32_t uv_ptr(void) { return (uintptr_t)uvs; }
EMSCRIPTEN_KEEPALIVE uint32_t index_ptr(void) { return (uintptr_t)indices; }
EMSCRIPTEN_KEEPALIVE uint32_t vertex_count(void) { return nv; }
EMSCRIPTEN_KEEPALIVE uint32_t index_count(void) { return ni; }
EMSCRIPTEN_KEEPALIVE int decode_fmdl(const uint8_t *input, uint32_t size) {
    release_geometry(); data=input; length=size; bad=0; memset(tables,0,sizeof(tables));
    if(size<64 || memcmp(data,"FMDL",4)) return -1;
    if(readn(12,4)) return -2; // table offsets over 4 GB are not supported
    uint32_t table=readn(8,4), fc=readn(32,4), bc=readn(36,4);
    uint32_t fb=readn(40,4), bb=readn(48,4), vertex_base=0, vertex_size=0;
    if(fc>256 || bc>256 || (uint64_t)table+fc*8+bc*12>size) return -2;
    for(uint32_t i=0;i<fc;i++) {
        uint64_t h=(uint64_t)table+i*8; unsigned kind=readn(h,1);
        uint64_t off=(uint64_t)fb+readn(h+4,4);
        if(off>size) return -2;
        tables[kind]=(Table){off,readn(h+1,1)*65536+readn(h+2,2)};
    }
    for(uint32_t i=0;i<bc;i++) {
        uint64_t h=(uint64_t)table+fc*8+i*12;
        if(readn(h,4)==2) { uint64_t off=(uint64_t)bb+readn(h+4,4); vertex_size=readn(h+8,4);
            if(off+vertex_size>size) return -2; vertex_base=off; }
    }
    if(!vertex_base || !tables[3].count || tables[3].count>65536) return -2;
    uint64_t total_v=0,total_i=0;
    for(uint32_t m=0;m<tables[3].count;m++) {
        uint64_t r=(uint64_t)tables[3].offset+m*48;
        total_v+=readn(r+10,2); total_i+=readn(r+20,4);
    }
    if(bad || !total_v || !total_i || total_v>4000000 || total_i>12000000) return -3;
    tangents=calloc(total_v*4,sizeof(float)); uvs=calloc(total_v*2,sizeof(float)); vertices=calloc(total_v*6,sizeof(float)); indices=malloc(total_i*4);
    if(!vertices || !indices || !uvs || !tangents) { release_geometry(); return -4; }
    uint32_t file_offset[256]={0},file_size[256]={0},file_type[256]={0},index_base=0,index_size=0;
    if(tables[14].count>256) goto invalid;
    for(uint32_t i=0;i<tables[14].count;i++) {
        uint64_t r=(uint64_t)tables[14].offset+i*16;
        file_type[i]=readn(r,2); file_size[i]=readn(r+4,4);
        uint64_t offset=(uint64_t)vertex_base+readn(r+8,4);
        if(offset+file_size[i]>(uint64_t)vertex_base+vertex_size) goto invalid;
        file_offset[i]=offset;
        if(i==0){raw_offset=offset;raw_size=file_size[i];}
        if(file_type[i]==1) { index_base=offset; index_size=file_size[i]; }
    }
    if(!index_base) goto invalid;
    for(uint32_t m=0;m<tables[3].count;m++) {
        uint64_t r=(uint64_t)tables[3].offset+m*48;
        uint32_t layout=readn(r+8,2),count=readn(r+10,2),first=readn(r+16,4),ic=readn(r+20,4);
        if(layout>=tables[9].count || ic%3 || ((uint64_t)first+ic)*2>index_size) goto invalid;
        uint64_t lay=(uint64_t)tables[9].offset+layout*8;
        unsigned sc=readn(lay,1),fs=readn(lay+4,2),ec=readn(lay+6,2),has_position=0;
        if((uint64_t)fs+sc>tables[10].count) goto invalid;
        for(uint32_t v=0;v<count;v++) vertices[(nv+v)*6+4]=1;
        for(unsigned s=0;s<sc;s++) {
            uint64_t st=(uint64_t)tables[10].offset+(fs+s)*8;
            unsigned f=readn(st,1),elements=readn(st+1,1),stride=readn(st+2,1); uint32_t off=readn(st+4,4);
            if(f>=tables[14].count || file_type[f]!=0 || !stride || (uint64_t)off+count*stride>file_size[f]) goto invalid;
            for(unsigned e=0;e<elements;e++,ec++) {
                if(ec>=tables[11].count) goto invalid;
                uint64_t el=(uint64_t)tables[11].offset+ec*4;
                unsigned usage=readn(el,1),fmt=readn(el+1,1),eo=readn(el+2,2);
                if(usage!=0 && usage!=2 && usage!=8 && usage!=14) continue;
                if((fmt!=1 && fmt!=6 && !(fmt==7 && usage==8)) || eo+(fmt==1?(usage==8?8:12):(usage==8?4:8))>stride) goto invalid;
                if(usage==0) has_position=1;
                for(uint32_t v=0;v<count;v++) for(unsigned c=0;c<(usage==8?2:usage==14?4:3);c++) {
                    float value=(usage==14 && fmt==1 && c==3)?1.0f:component((uint64_t)file_offset[f]+off+v*stride+eo,fmt,c);
                    if(!isfinite(value) && usage!=14) goto invalid;
                    if(usage==14) tangents[(nv+v)*4+c]=value; else if(usage==8) uvs[(nv+v)*2+c]=value; else vertices[(nv+v)*6+(usage==2?3:0)+c]=value;
                }
            }
        }
        if(!has_position) goto invalid;
        for(uint32_t i=0;i<ic;i++) { uint32_t idx=readn((uint64_t)index_base+(first+i)*2,2);
            if(idx>=count) goto invalid; indices[ni++]=nv+idx; }
        nv+=count;
    }
    if(bad) goto invalid;
    for(uint32_t v=0;v<nv;v++) if(!isfinite(tangents[v*4]) || !isfinite(tangents[v*4+1]) || !isfinite(tangents[v*4+2]) || !isfinite(tangents[v*4+3])) memset(tangents+v*4,0,4*sizeof(float));
    return 0;
invalid:
    release_geometry(); return -5;
}
