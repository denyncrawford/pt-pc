// Original UIF/UIA/UILB/FFNT readers shared with the native port.
#include <emscripten/emscripten.h>
#include "engine/ui/uif.h"
#include "engine/ui/uia.h"
#include "engine/ui/uilb.h"
#include "engine/ui/ffnt.h"
#include "engine/ui/lang_file.h"
#include "engine/data/fox2.h"
#include "engine/core/strcode.h"
#include <sstream>
#include <iomanip>
using namespace pt::ui;
namespace {
std::string result; std::vector<std::vector<uint8_t>> atlas;
void quote(std::ostream& o,const std::string& s){o<<'"';for(unsigned char c:s){if(c=='"'||c=='\\')o<<'\\'<<c;else if(c<32)o<<"\\u00"<<std::hex<<std::setw(2)<<std::setfill('0')<<int(c)<<std::dec;else o<<c;}o<<'"';}
template<class T> void array(std::ostream&o,const T& v){o<<'[';bool first=true;for(auto x:v){if(!first)o<<',';first=false;o<<x;}o<<']';}
template<int N> void vec(std::ostream&o,const glm::vec<N,float>&v){o<<'[';for(int i=0;i<N;i++){if(i)o<<',';o<<v[i];}o<<']';}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE const char* ui_read(const uint8_t* p,int size,int kind){
 std::span<const uint8_t>d(p,size);std::ostringstream o;std::string error;bool ok=false;
 if(kind==0){UifModel m;ok=m.Parse(d,&error);if(ok){o<<"{\"textures\":[";bool first=true;for(auto&s:m.Textures()){if(!first)o<<',';first=false;quote(o,s);}o<<"],\"nodes\":[";int i=0;for(auto&n:m.Nodes()){if(i++)o<<',';o<<"{\"id\":"<<n.id<<",\"hash\":"<<uint32_t(n.id<m.Names().size()?m.Names()[n.id]:0)<<",\"materialHash\":"<<uint32_t(n.material_name)<<",\"fontHash\":"<<uint32_t(n.font_name)<<",\"type\":"<<int(n.type)<<",\"parent\":"<<n.parent<<",\"flags\":"<<n.flags<<",\"textFlags\":"<<n.text_flags<<",\"priority\":"<<n.priority;for(auto [k,v]:{std::pair{"rotation",n.rotation},{"translate",n.translate},{"color",n.color},{"boxMin",n.box_min},{"boxMax",n.box_max}}){o<<",\""<<k<<"\":";vec(o,v);}o<<",\"size\":";vec(o,n.size);o<<",\"scale\":";vec(o,n.scale);o<<",\"positions\":[";first=true;for(auto v:n.positions){if(!first)o<<',';first=false;vec(o,v);}o<<"],\"uvs\":[";first=true;for(auto v:n.uvs){if(!first)o<<',';first=false;vec(o,v);}o<<"],\"indices\":";array(o,n.indices);o<<",\"textures\":";array(o,n.material.textures);o<<",\"params\":";array(o,n.material.params);o<<",\"points\":[";first=true;for(auto&v:n.points){if(!first)o<<',';first=false;o<<"{\"hash\":"<<uint32_t(v.name)<<",\"position\":";vec(o,v.position);o<<",\"vertices\":";array(o,v.vertices);o<<'}';}o<<"]}";}o<<"]}";}}
 if(kind==1){UiaAnimation a;ok=a.Parse(d,&error);if(ok){o<<"{\"frames\":"<<a.Frames()<<",\"nodes\":[";bool first=true;for(auto&n:a.Nodes()){if(!first)o<<',';first=false;o<<"{\"hash\":"<<n.node<<",\"tracks\":[";bool f=true;for(auto&t:n.tracks){if(!f)o<<',';f=false;o<<"{\"unit\":"<<t.unit<<",\"slot\":"<<UifParamSlot(t.unit)<<",\"frames\":";array(o,t.frames);o<<",\"values\":[";for(int i=0;i<int(t.frames.size());i++){if(i)o<<',';vec(o,UiaAnimation::Sample(t,float(t.frames[i])));}o<<"]}";}o<<"]}";}o<<"]}";}}
 if(kind==2){UilbLayout l;ok=l.Parse(d,&error);if(ok){o<<"{\"animations\":[";bool first=true;for(auto&a:l.Animations()){if(!first)o<<',';first=false;o<<"{\"main\":";quote(o,a.main);o<<",\"shader\":";quote(o,a.shader);o<<",\"speed\":"<<a.speed<<'}';}o<<"]}";}}
 if(kind==3){LangFile l;ok=l.Parse(d,&error);if(ok){o<<'{';bool first=true;for(auto&[k,v]:l.Entries()){if(!first)o<<',';first=false;quote(o,k);o<<':';quote(o,v.text);}o<<'}';}}
 if(kind==4){FfntFont f;ok=f.Parse(d,&error)&&f.BuildAtlas(atlas,1);if(ok){o<<"{\"width\":"<<f.AtlasWidth()<<",\"height\":"<<f.AtlasHeight()<<",\"em\":"<<f.EmSize()<<",\"pad\":"<<f.Pad()<<",\"glyphs\":[";bool first=true;for(auto&g:f.Glyphs()){if(!first)o<<',';first=false;o<<'['<<g.code<<','<<g.atlas_x<<','<<g.atlas_y<<','<<g.width<<','<<g.height<<','<<f.Advance(g)<<','<<g.bearing<<','<<g.top<<']';}o<<"]}";}}
 if(kind==5){pt::fox2::DataSetFile f;ok=f.Load("ui.fox2",d);if(ok){o<<'[';bool first=true;for(auto&e:f.Entities())if(e.class_name=="UiFontDataElement"){if(!first)o<<',';first=false;o<<"{\"hash\":"<<uint32_t(pt::StrCode64(f.GetString(e,"fontName")))<<",\"language\":";quote(o,f.GetString(e,"language"));for(auto k:{"fontWidth","fontHeight","textSpace","lineSpace"})o<<",\""<<k<<"\":"<<f.GetFloat(e,k);o<<'}';}o<<']';}}
 if(!ok){o.str("");o<<"{\"error\":";quote(o,error.empty()?"Invalid UI resource":error);o<<'}';}result=o.str();return result.c_str();
}
EMSCRIPTEN_KEEPALIVE const uint8_t* ui_atlas(){return atlas.empty()?nullptr:atlas[0].data();}
EMSCRIPTEN_KEEPALIVE int ui_atlas_size(){return atlas.empty()?0:atlas[0].size();}
}
