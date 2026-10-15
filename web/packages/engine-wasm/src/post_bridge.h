// Read-only import of native resident grading paths and ShParameter lighting rows.
#include "game/parameters.h"
static pt::game::GameParameters post_parameters;
static std::map<std::string,std::string> post_luts;
static glm::vec3 post_scale{1,1.12f,1.3f};static float post_start=.4f,post_end=.6f;
static int PostReload(lua_State* L){return post_parameters.LoadFromLua(L,1)?0:luaL_error(L,"Invalid parameter tables");}
extern "C" {
EMSCRIPTEN_KEEPALIVE const float* handy_light_data(){
 static float d[28];const auto& p=post_parameters.handy_light;constexpr float pi=3.14159265358979323846f;
 const auto rgb=pt::light_math::ColorFromTemperature(p.temperature,0,p.lumen,{p.color[0],p.color[1],p.color[2]})*p.power_scale/(pt::light_math::SpotSolidAngle(p.umbra_angle,p.penumbra_angle,p.attenuation_exponent)*pi);
 std::fill(std::begin(d),std::end(d),0);d[3]=p.outer_range;for(int i=0;i<3;i++)d[4+i]=rgb[i];
 d[10]=-1;d[11]=cos(p.umbra_angle*pi/360);d[12]=cos(p.penumbra_angle*pi/360);d[13]=p.attenuation_exponent;d[14]=p.inner_range;d[15]=1;d[17]=1;d[18]=p.lumen;d[19]=pt::light_math::SourceRadius(p.light_size);d[20]=-.01f;d[21]=-.005f;d[22]=1;d[23]=cos(78*pi/360);d[24]=100000;return d;
}
EMSCRIPTEN_KEEPALIVE void post_reset(){post_parameters={};post_luts.clear();post_scale={1,1.12f,1.3f};post_start=.4f;post_end=.6f;}
EMSCRIPTEN_KEEPALIVE int post_import(const uint8_t* bytes,int size,int lua){
 if(size<=0)return 0;
 if(lua){pt::LuaVm vm;const luaL_Reg api[]={{"ReloadParameterTables",PostReload},{nullptr,nullptr}};vm.RegisterModule("ShParameter",api);lua_sethook(vm.State(),ScriptBudget,LUA_MASKCOUNT,1000000);return vm.RunChunk("ShParameterTables",{bytes,size_t(size)});}
 pt::fox2::DataSetFile f;if(!f.Load("resident settings",{bytes,size_t(size)}))return 0;
 for(const auto& e:f.Entities())if(e.class_name=="ColorCorrectionData"){post_scale=glm::vec3(f.GetVec4(e,"colorScale"));post_start=f.GetFloat(e,"startSlope",0,.4f);post_end=f.GetFloat(e,"endSlope",0,.6f);}
 for(const auto& e:f.Entities())if(e.class_name=="ShTextureLoader")if(auto p=f.FindProperty(e,"textures"))for(size_t i=0;i<p->Count();i++){auto path=f.ElementString(*p,i);if(auto dot=path.find_last_of('.');dot!=std::string::npos&&dot>path.find_last_of('/'))path.resize(dot);post_luts[f.KeyString(*p,i)]=path;}
 return 1;
}
EMSCRIPTEN_KEEPALIVE const char* post_settings(const char* floor){
 static std::string result;std::ostringstream o;auto it=post_parameters.lighting.find(floor?floor:"");if(it==post_parameters.lighting.end())return "{}";auto& r=it->second;
 o<<"{\"scale\":["<<post_scale.x<<","<<post_scale.y<<","<<post_scale.z<<"],\"start\":"<<post_start<<",\"end\":"<<post_end<<",\"min\":"<<r.min_exposure<<",\"max\":"<<r.max_exposure<<",\"compensation\":"<<r.exposure_compensation<<",\"key\":"<<r.key_value<<",\"add\":[";for(int i=0;i<3;i++){if(i)o<<",";o<<r.add_exp_comp[i];}o<<"],\"ev\":[";for(int i=0;i<3;i++){if(i)o<<",";o<<r.add_exp_comp_ev[i];}o<<"],\"weight\":"<<r.bloom_weight<<",\"extraction\":"<<r.bloom_brightness_extraction<<",\"size\":"<<r.bloom_size<<",\"luts\":{";bool first=true;for(auto& [k,v]:post_luts){if(!first)o<<",";first=false;o<<std::quoted(k)<<":"<<std::quoted(v);}o<<"}}";result=o.str();return result.c_str();
}
}
