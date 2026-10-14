// Reuse the port's StrCode64 to decode individually wrapped FPK entries.
#include "engine/core/strcode.h"
#include <cstdint>
#include <string>
#include <emscripten/emscripten.h>
extern "C" EMSCRIPTEN_KEEPALIVE uint32_t decrypt_entry(uint8_t* data, uint32_t size, const char* path) {
    if(size<2 || !path || (data[0]!=0x1b && data[0]!=0x1c)) return 0;
    std::string name(path);
    if(name.size()>4096) return 0;
    const auto slash=name.find_last_of('/'); if(slash!=std::string::npos) name.erase(0,slash+1);
    for(char& c:name) if(c>='A' && c<='Z') c+=32;
    const uint64_t hash=~pt::StrCode64(name);
    uint8_t key[8]; for(unsigned i=0;i<8;i++) key[i]=(hash>>(i*8))&255;
    for(uint32_t i=0;i+1<size;i++) {key[i%8]^=data[i+1];data[i]=key[i%8];}
    return data[size-2]==0 ? size-2 : 0;
}
