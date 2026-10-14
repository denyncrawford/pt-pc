// Browser bridge to the same scene reader and collision controller used by the native game.
#include <emscripten/emscripten.h>
#include <glm/gtc/type_ptr.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include "engine/core/log.h"
#include "engine/physics/collision_world.h"
#include "game/stage_data.h"
#include "game/floor_order.h"
#include "game/trap_query.h"
#include <cstdio>
#include <algorithm>
#include <cmath>
#include <sstream>
#include <iomanip>
#include "engine/render/scene_lighting.h"
#include "engine/core/pathcode.h"
namespace pt { void LogWrite(LogLevel, std::string_view s) { printf("%.*s\n", int(s.size()), s.data()); } }
static std::unique_ptr<pt::game::StageData> stage;
static pt::CollisionWorld world;
static pt::CharacterController player;
static float output[4];
static glm::vec3 player_displacement(0);
static float player_elapsed=0;
static glm::vec3 player_previous(0);
struct Surface {pt::CollisionTriangle triangle;uint32_t material;uint32_t owner;};
static std::vector<Surface> surfaces;
static const pt::fox2::Entity* sound_area=nullptr;
static std::vector<const pt::fox2::Entity*> sound_sources;

static std::vector<const pt::fox2::Entity*> probes;
struct BrowserTrapRequest {const pt::game::TrapCondition* condition;const pt::game::TrapCallback* callback;int flag;};
static std::vector<BrowserTrapRequest> requests;
static std::unordered_map<const pt::fox2::Entity*, bool> trap_hits;
static std::unordered_map<const pt::fox2::Entity*, bool> trap_done;
static uint32_t geom_owner=0,owner_count=1;
static std::unordered_map<const pt::fox2::Entity*,bool> model_visible;

 #include "script_bridge.h"
static uint32_t photo_word=1;
static bool photo_active=false;
static uint32_t photo_armed=0;
static float photo_hold=0;
static bool zoom_held=false,zoom_pressed=false;
static glm::vec3 view_eye(0),view_forward(0,0,-1),view_right(1,0,0),view_up(0,1,0);
static float view_tan=0.5f;
static bool InView(const pt::fox2::Entity* locator,float area){
 if(!stage||!locator)return false;
 const glm::vec3 offset=glm::vec3(stage->file->WorldTransform(*locator)[3])-view_eye;
 const float depth=glm::dot(offset,view_forward);
 if(!(depth>0&&depth<1000))return false;
 return std::abs(glm::dot(offset,view_right)/(depth*view_tan*(16.0f/9.0f)))<area&&std::abs(glm::dot(offset,view_up)/(depth*view_tan))<area;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE uint64_t texture_pathcode(const char* path) {return pt::PathCode64(path);}
EMSCRIPTEN_KEEPALIVE int scene_load(const uint8_t* data, int size) {
 auto file=std::make_shared<pt::fox2::DataSetFile>();
 if(size<=0 || !file->Load("hallway", {data,size_t(size)})) return 0;
 photo_word=1;photo_active=false;photo_armed=0;photo_hold=0;zoom_held=false;zoom_pressed=false;stage=pt::game::BuildStageData(file,"hallway"); ResetScriptHost(); requests.clear();trap_hits.clear();trap_done.clear();model_visible.clear(); probes.clear();for(const auto& e:file->Entities())if(e.class_name=="ShLightProbe")probes.push_back(&e); return stage->static_models.size();
}
EMSCRIPTEN_KEEPALIVE const char* scene_model_name(int i){return stage->static_models.at(i).name.c_str();}
EMSCRIPTEN_KEEPALIVE void scene_model_visibility(int i,int visible){model_visible[stage->static_models.at(i).entity]=visible!=0;}
EMSCRIPTEN_KEEPALIVE int scene_model_visible(int i){const auto* e=stage->static_models.at(i).entity;auto it=model_visible.find(e);return it==model_visible.end()?int((stage->file->GetUInt(*e,"flags",0,7)&1)!=0):int(it->second);}
EMSCRIPTEN_KEEPALIVE const char* scene_model_nazo(int i){static std::string name;name.clear();const auto* target=stage->static_models.at(i).entity;for(const auto& e:stage->file->Entities())if(e.class_name=="NazoManageData")for(const auto& [key,ref]:stage->file->GetEntityMap(e,"controlAsset"))if(ref==target){name=key;return name.c_str();}return name.c_str();}
// Photo word and asset rules ported from NazoManager::ApplyVisuals/SetCondition.
static int photo_apply(){if(!stage)return 0;int changed=0;const auto& f=*stage->file;
 const char* pieces[]={"PhotoLisa","PhotoTree","PhotoGap","PhotoBath","PhotoStair"};
 const char* frames[]={"FrameLisa","FrameTree","FrameGap","FrameBath","FrameStair"};
 for(const auto& e:f.Entities())if(e.class_name=="NazoManageData")for(const auto& [key,target]:f.GetEntityMap(e,"controlAsset")){
  if(!target)continue;int on=-1;
  if(key=="FrameWall")on=!(photo_word&2);else if(key=="FrameGround")on=!!(photo_word&2);
  for(int i=0;i<5;i++){if(key==pieces[i])on=(photo_word&4)&&!(photo_word&(8u<<i));if(key==frames[i]&&(photo_word&4))on=!!(photo_word&(8u<<i));}
  if(key=="FrameOption"&&(photo_word&4))on=!!(photo_word&0x100);
  if(on<0)continue;
  if(target->class_name=="StaticModel"){model_visible[target]=on;script_commands.push_back({"GeomActive",{f.EntityName(*target),on?"1":"0"}});}else if(target->class_name=="FxLocatorData")return -1;else body_enabled[target]=on;++changed;
 }return changed;
}
EMSCRIPTEN_KEEPALIVE int scene_photo_prepare(){if(!(photo_word&2))photo_word=2;return photo_apply();}
EMSCRIPTEN_KEEPALIVE int scene_photo_word(){return photo_word;}
EMSCRIPTEN_KEEPALIVE int scene_photo_pending(){return stage&&photo_active&&!(photo_word&0x100);}
EMSCRIPTEN_KEEPALIVE int scene_photo_collect_option(){if(!scene_photo_pending())return 0;photo_word|=0x100;photo_apply();return 1;}
// The native Photo puzzle arms on a Zoom press in the authored trap and
// commits only after two seconds held (NazoManager::Arm/Update/Commit).
EMSCRIPTEN_KEEPALIVE int events_view(float x,float y,float z,float yaw,float pitch,float fov,int held,float dt){
 view_eye={x,y,z};view_forward={std::sin(yaw)*std::cos(pitch),std::sin(pitch),-std::cos(yaw)*std::cos(pitch)};
 view_right={std::cos(yaw),0,std::sin(yaw)};view_up=glm::cross(view_right,view_forward);
 view_tan=std::tan(fov*0.5f);zoom_pressed=held&&!zoom_held;zoom_held=held!=0;
 if(!zoom_held){photo_armed=0;photo_hold=0;return 0;}
 if(!photo_armed)return 0;
 photo_hold+=std::clamp(dt,0.0f,0.1f);
 if(photo_hold<=2.0f)return 0;
 const uint32_t collected=photo_armed;photo_word|=collected;photo_armed=0;photo_hold=0;photo_apply();return collected;
}
static void photo_floor(const std::string& name){
 photo_armed=0;photo_hold=0;zoom_held=false;zoom_pressed=false;
 // FloorLevel::RelocateGimmicks: f005 preserves the prepared state; subsequent
 // playable floors activate Photo without discarding its collected-piece bits.
 if(name=="f000"||name=="f010"){photo_active=false;photo_word=1;}
 else if(name=="f005")return;
 else if(name=="f020"||name=="f030"||name=="f040"||name=="f050"||name=="f060"||name=="f070"||name=="f080"||name=="f090"||name=="f100"||name=="f110"||name=="f120"||name=="f160"){photo_active=true;photo_word=(photo_word&~3u)|4;}
 else return;
 photo_apply();
}
EMSCRIPTEN_KEEPALIVE const char* scene_model(int i) {return stage->static_models.at(i).model_file.c_str();}
EMSCRIPTEN_KEEPALIVE const char* scene_geom(int i) {return stage->static_models.at(i).geom_file.c_str();}
EMSCRIPTEN_KEEPALIVE const float* scene_matrix(int i) {return glm::value_ptr(stage->static_models.at(i).world);}
EMSCRIPTEN_KEEPALIVE int light_count() { return stage->lights.size(); }
EMSCRIPTEN_KEEPALIVE const char* light_name(int i) {return stage->lights.at(i).name.c_str();}
EMSCRIPTEN_KEEPALIVE const float* light_data(int i) {
 static float values[28];const auto& l=stage->lights.at(i);const auto& f=*stage->file;const auto& e=*l.entity;
 auto reach=glm::vec3(f.GetVec4(e,"reachPoint"));if(glm::length(reach)<0.0001f)reach={0,-1,0};
 auto direction=glm::normalize(glm::mat3(l.world)*reach);
 const bool spot=l.class_name=="SpotLight";const float pi=3.14159265358979323846f;
 auto rgb=pt::light_math::ColorFromTemperature(l.temperature,f.GetFloat(e,"colorDeflection"),l.lumen,glm::vec3(l.color));
 rgb*=spot?f.GetFloat(e,"powerScale",0,1.0f)/(pt::light_math::SpotSolidAngle(l.umbra_angle,l.penumbra_angle,l.attenuation_exponent)*pi):1.0f/(4*pi*pi);
 for(int k=0;k<3;k++){values[k]=l.world[3][k];values[4+k]=rgb[k];values[8+k]=direction[k];}
 values[3]=l.outer_range;values[7]=l.dimmer;values[11]=spot?cos(l.umbra_angle*pi/360):-1;
 values[12]=spot?cos(l.penumbra_angle*pi/360):-1;values[13]=l.attenuation_exponent;values[14]=l.inner_range;values[15]=l.cast_shadow;
 values[16]=BodyEnabled(l.entity,l.enable);values[17]=l.has_specular;values[18]=l.lumen;values[19]=pt::light_math::SourceRadius(l.light_size);
 values[20]=f.GetFloat(e,"shadowBias")*.001f;values[21]=spot?f.GetFloat(e,"viewBias")*.001f:0;
 values[22]=f.GetFloat(e,"LodShadowDrawRate",0,1);values[23]=spot?cos(f.GetFloat(e,"shadowUmbraAngle",0,l.umbra_angle)*pi/360):-1;
 const float inner=spot?cos(f.GetFloat(e,"shadowPenumbraAngle",0,l.penumbra_angle)*pi/360):-1;
 values[24]=1.0f/std::max(inner-values[23],.00001f);values[25]=values[26]=values[27]=0;
 return values;
}
EMSCRIPTEN_KEEPALIVE int probe_enabled(int i){const auto* e=probes.at(i);return BodyEnabled(e,stage->file->GetBool(*e,"enable",0,true));}
EMSCRIPTEN_KEEPALIVE int probe_count(){return probes.size();}
EMSCRIPTEN_KEEPALIVE const char* probe_name(int i){static std::string name;name=stage->file->EntityName(*probes.at(i));return name.c_str();}
EMSCRIPTEN_KEEPALIVE const char* probe_path(int i){static std::string path;const auto& f=*stage->file;auto c=f.GetEntity(*probes.at(i),"shCoefficientsData");path=c?f.GetString(*c,"lpshFile"):"";if(path.empty()&&c)path=f.GetString(*c,"filePath");return path.c_str();}
EMSCRIPTEN_KEEPALIVE const float* probe_data(int i){
 static float data[28];const auto& f=*stage->file;const auto& e=*probes.at(i);auto area=f.GetEntity(e,"lightArea");if(!area)return nullptr;
 auto box=f.WorldTransform(*area)*glm::scale(glm::mat4(1),glm::vec3(.5f));if(std::abs(glm::determinant(box))<1e-12)return nullptr;
 auto inverse=glm::inverse(box);std::copy(glm::value_ptr(inverse),glm::value_ptr(inverse)+16,data);
 const char* names[]={"innerScaleXPositive","innerScaleYPositive","innerScaleZPositive","innerScaleXNegative","innerScaleYNegative","innerScaleZNegative"};
 for(int k=0;k<6;k++){float v=f.GetFloat(e,names[k],0,1);data[16+k]=v>=.9999f?1e4f:1/(1-v);}
 data[22]=f.GetInt(e,"priority");data[23]=(f.GetUInt(e,"localFlags")&16u)?1:0;return data;
}
// Read-only diagnostic view of the native FOX2 entities; no game state mutation.
EMSCRIPTEN_KEEPALIVE const char* scene_audit_json(){
 static std::string result;std::ostringstream out;out<<"[";bool first=true;
 if(stage)for(const auto& e:stage->file->Entities()){
  bool condition=false;for(const auto& t:stage->traps)for(const auto& c:t.conditions)condition|=c.entity==&e;
  if(!condition&&e.class_name.find("Trap")==std::string::npos&&e.class_name!="ShDemoScript"&&e.class_name!="ShGameControllerMessageScript"&&e.class_name!="FxLocatorData")continue;
  const auto& f=*stage->file;if(!first)out<<",";first=false;
  out<<"{\"name\":"<<std::quoted(f.EntityName(e))<<",\"class\":"<<std::quoted(e.class_name)<<",\"properties\":{";bool fp=true;
  for(const auto* list:{&e.properties,&e.dynamic_properties})for(const auto& p:*list){
   if(!fp)out<<",";fp=false;out<<std::quoted(p.name)<<":[";
   for(size_t n=0;n<p.Count();n++){if(n)out<<",";using D=pt::fox2::DataType;
    switch(p.type){
     case D::String:case D::Path:case D::FilePtr:out<<std::quoted(f.ElementString(p,n));break;
     case D::EntityPtr:case D::EntityHandle:case D::EntityLink:{auto ref=f.ElementEntity(p,n);if(ref)out<<std::quoted(f.EntityName(*ref));else out<<"null";break;}
     case D::Float:out<<f.GetFloat(e,p.name,n);break;
     case D::Bool:out<<(f.GetBool(e,p.name,n)?"true":"false");break;
     case D::Vector3:case D::Vector4:case D::Quat:case D::Matrix3:case D::Matrix4:out<<"null";break;
     default:out<<f.GetInt(e,p.name,n);break;
    }
   }out<<"]";
  }out<<"}}";
 }out<<"]";result=out.str();return result.c_str();
}
EMSCRIPTEN_KEEPALIVE int scene_is_mirror(int i){const auto model=stage->static_models.at(i).entity;for(const auto& e:stage->file->Entities())if(e.class_name=="Mirror"&&stage->file->GetEntity(e,"staticModelHandle")==model)return 1;return 0;}
// Requests stay pending until a host really executes their callback. Detection is
// deliberately not completion: absent Lua/demo/audio hosts must never advance a loop.
EMSCRIPTEN_KEEPALIVE void events_reset(){requests.clear();trap_hits.clear();trap_done.clear();}
EMSCRIPTEN_KEEPALIVE int events_tick(float x,float y,float z,float body_yaw,float move_x,float move_z){
 requests.clear();if(!stage||!std::isfinite(x+y+z+body_yaw+move_x+move_z))return -1;
 const auto& f=*stage->file;std::vector<BrowserTrapRequest> out,enter,inside;
 auto wrap=[](float a){return std::atan2(std::sin(a),std::cos(a));};
 for(const auto& trap:stage->traps){
  // Common traps and the current floor share the original condition state.
  if(!(script_floor=="f000"&&trap.name.starts_with("pt14_start|"))&&trap.name.find("|common_demo|")==std::string::npos&&trap.name.find("|"+script_floor+"_demo|")==std::string::npos&&trap.name.find("|pt14_hallway_trap0000|")==std::string::npos&&trap.name.find("|pt14_hallway_nazo|")==std::string::npos)continue;
  bool hit=BodyEnabled(trap.entity,trap.enable)&&pt::game::PointInTrap(trap.boxes,glm::mat4(1),{x,y+player.shape.center_height,z});
  for(const auto& c:trap.conditions){bool match=hit&&BodyEnabled(c.entity,c.enable)&&!(c.is_once&&trap_done[c.entity]);
   for(const auto& check:c.checks){if(!match||!check.entity)continue;const auto& e=*check.entity;
    if(check.class_name=="ShTrapCheckIsPlayerCallbackDataElement")continue;
    if(check.class_name!="ShTrapCheckPlayerInputDirectionCallbackDataElement"){match=false;continue;}
    auto target=f.GetEntity(e,"targetLink");const auto m=f.WorldTransform(target?*target:*trap.entity);const float yaw=std::atan2(m[2].x,m[2].z),limit=glm::radians(f.GetFloat(e,"degreeLimit",0,45));
    if(f.GetBool(e,"isCheckPlayerDir")&&std::abs(wrap(body_yaw-yaw))>limit)match=false;
    if(f.GetBool(e,"isCheckButton",0,true)){const auto input=f.GetString(e,"input");if(input=="Zoom"&&!zoom_pressed)match=false;else if(input=="LStick"&&(std::hypot(move_x,move_z)<=0||std::abs(wrap(std::atan2(move_x,move_z)-yaw))>limit))match=false;}
   }
   const bool was=trap_hits[c.entity];trap_hits[c.entity]=match;int flag=match?(was?4:1):(was?2:0);if(!flag)continue;
   for(const auto& cb:c.execs){if(!cb.entity)continue;const auto& e=*cb.entity;
    if(cb.class_name=="ShTrapExecRelativeStageDemoPlayCallbackDataElement"){
     if(flag!=1)continue;if(f.GetBool(e,"orderFloorDemo")){bool floor=false;auto p=f.FindProperty(e,"floorNameArray");for(size_t i=0;p&&i<p->Count();i++)floor|=f.ElementString(*p,i)==script_floor;if(!floor)continue;}
    }else if(cb.class_name=="GeoTrapScriptCallbackDataElement"){
     if(flag==4)continue;if(f.GetBool(*c.entity,"orderFloor")&&f.GetString(*c.entity,"floorName")!=script_floor)continue;
    }
    if(cb.class_name=="ShTrapExecNazoCallbackDataElement"){
     const auto name=f.GetString(e,"checkName");
     const char* pieces[]={"PhotoLisa","PhotoTree","PhotoGap","PhotoBath","PhotoStair"};
     bool photo=false;for(int i=0;i<5;i++)if(name==pieces[i]){
      photo=true;const uint32_t bit=8u<<i;
      if(flag==4&&photo_active&&!(photo_word&bit)&&!photo_armed&&zoom_pressed&&InView(f.GetEntity(e,"checkLocator"),f.GetFloat(e,"checkAreaSize",0,0.4f))){photo_armed=bit;photo_hold=0;}
     }
     if(photo)continue;
    }
    BrowserTrapRequest request{&c,&cb,flag};(flag==2?out:flag==1?enter:inside).push_back(request);
   }
  }
 }
 for(const auto* list:{&out,&enter,&inside})requests.insert(requests.end(),list->begin(),list->end());return requests.size();
}
EMSCRIPTEN_KEEPALIVE int trap_count(){return stage?stage->traps.size():0;}
EMSCRIPTEN_KEEPALIVE const char* trap_name(int i){return stage->traps.at(i).name.c_str();}
EMSCRIPTEN_KEEPALIVE int trap_box_count(int i){return stage->traps.at(i).boxes.size();}
EMSCRIPTEN_KEEPALIVE const float* trap_box(int i,int j){return glm::value_ptr(stage->traps.at(i).boxes.at(j));}
EMSCRIPTEN_KEEPALIVE const char* event_condition(int i){return requests.at(i).condition->name.c_str();}
EMSCRIPTEN_KEEPALIVE const char* event_kind(int i){return requests.at(i).callback->class_name.c_str();}
EMSCRIPTEN_KEEPALIVE int event_flag(int i){return requests.at(i).flag;}
EMSCRIPTEN_KEEPALIVE const char* event_target(int i){static std::string value;const auto& r=requests.at(i);value=stage->file->GetString(*r.callback->entity,r.callback->class_name=="GeoTrapScriptCallbackDataElement"?"scriptFile":"demoId");return value.c_str();}
// Explicitly retry a deferred host request without changing native Enter semantics.
EMSCRIPTEN_KEEPALIVE int event_retry(int i){if(i<0||size_t(i)>=requests.size())return 0;trap_hits[requests[i].condition->entity]=false;return 1;}
EMSCRIPTEN_KEEPALIVE int event_ack(int i,int executed){if(i<0||size_t(i)>=requests.size()||executed!=1)return 0;trap_done[requests[i].condition->entity]=true;return 1;}
EMSCRIPTEN_KEEPALIVE int world_owner_active(int owner,int active){if(owner<=0||unsigned(owner)>=owner_count)return 0;world.SetOwnerActive(owner,active!=0);return 1;}
// Port of demoScriptEnableStaticModel.lua's two body writes. Called only when
// an actual demo host emits a message; a trap request alone must not open a door.
EMSCRIPTEN_KEEPALIVE int events_demo_message(const char* demo,const char* message){
 if(!stage||!demo||!message)return -1;const auto& f=*stage->file;int applied=0;
 // Preflight the complete matching message batch, so unsupported handlers cannot
 // leave half-applied visibility/collision changes.
 std::vector<const pt::game::MessageScript*> matching;
 for(const auto& script:stage->message_scripts){
  if(script.class_name!="ShDemoScript"||!script.enable||script.demo_id!=demo||script.message_name!=message)continue;
  if(script.order_floor&&std::find(script.floor_names.begin(),script.floor_names.end(),script_floor)==script.floor_names.end())continue;
  if(!script.script_file.ends_with("/demoScriptEnableStaticModel.lua"))return -2;
  const auto target=f.GetEntity(*script.entity,"targetData");if(!target||target->class_name!="StaticModel")return -3;
  matching.push_back(&script);
 }
 for(const auto* script:matching){const auto& e=*script->entity;const auto target=f.GetEntity(e,"targetData");model_visible[target]=f.GetBool(e,"isVisible");const auto name=f.EntityName(*target);for(uint32_t owner=1;owner<owner_count;owner++)if(world.OwnerName(owner)==name)world.SetOwnerActive(owner,f.GetBool(e,"isGeomActive"));++applied;}
 return applied;
}
EMSCRIPTEN_KEEPALIVE int script_load(const char* path,const uint8_t* bytes,int size){
 if(!script_vm||size<=0||size>4*1024*1024)return 0;auto L=script_vm->State();lua_sethook(L,ScriptBudget,LUA_MASKCOUNT,1000000);const bool ok=script_vm->RunChunk(path,{bytes,size_t(size)});lua_sethook(L,nullptr,0,0);return ok;
}
EMSCRIPTEN_KEEPALIVE int script_exec_request(int index){
 if(index<0||size_t(index)>=requests.size()||!script_vm)return -1;const auto& r=requests[index];if(r.callback->class_name!="GeoTrapScriptCallbackDataElement")return -2;
 const auto path=stage->file->GetString(*r.callback->entity,"scriptFile");auto table=path.substr(path.find_last_of('/')+1);table=table.substr(0,table.find_last_of('.'));
 auto bgm=script_bgm;auto enabled=body_enabled,visible=model_visible;const auto count=script_commands.size();auto L=script_vm->State();int result=0;
 lua_sethook(L,ScriptBudget,LUA_MASKCOUNT,1000000);const bool ok=script_vm->CallTableFunction(table,"Exec",1,1,[&](lua_State* L){lua_newtable(L);lua_pushstring(L,r.flag==1?"GEO_TRAP_S_ENTER":r.flag==2?"GEO_TRAP_S_OUT":"GEO_TRAP_S_INSIDE");lua_setfield(L,-2,"trapFlagString");PushScriptEntity(L,r.condition->entity);lua_setfield(L,-2,"conditionHandle");auto trap=stage->file->GetEntity(*r.condition->entity,"parent");PushScriptEntity(L,trap,true);lua_setfield(L,-2,"trapBodyHandle");PushScriptEntity(L,trap);lua_setfield(L,-2,"trapHandle");},&result);lua_sethook(L,nullptr,0,0);
 if(!ok){script_bgm=std::move(bgm);body_enabled=std::move(enabled);model_visible=std::move(visible);script_commands.resize(count);script_error="Unsupported or failed original script: "+path;return -3;}
 const int code=lua_isboolean(L,result)?int(lua_toboolean(L,result)):int(lua_tointeger(L,result));lua_settop(L,result-1);if(code==1)trap_done[r.condition->entity]=true;return code;
}
EMSCRIPTEN_KEEPALIVE int script_exec_condition(const char* name){for(const auto& trap:stage->traps)for(const auto& c:trap.conditions)if(c.name==name)for(const auto& cb:c.execs)if(cb.class_name=="GeoTrapScriptCallbackDataElement"){requests.push_back({&c,&cb,1});const int code=script_exec_request(requests.size()-1);requests.pop_back();return code;}return -1;}
EMSCRIPTEN_KEEPALIVE int script_demo_message(const char* demo,const char* message){int applied=0;for(const auto& s:stage->message_scripts){if(s.class_name!="ShDemoScript"||!BodyEnabled(s.entity,s.enable)||s.demo_id!=demo||s.message_name!=message)continue;if(s.order_floor&&std::find(s.floor_names.begin(),s.floor_names.end(),script_floor)==s.floor_names.end())continue;auto table=s.script_file.substr(s.script_file.find_last_of('/')+1);table=table.substr(0,table.find_last_of('.'));auto L=script_vm->State();int result;lua_sethook(L,ScriptBudget,LUA_MASKCOUNT,1000000);const bool ok=script_vm->CallTableFunction(table,"OnMessage",4,1,[&](lua_State* L){PushScriptEntity(L,s.entity);PushScriptEntity(L,s.entity,true);lua_pushstring(L,demo);lua_pushstring(L,message);},&result);lua_sethook(L,nullptr,0,0);if(!ok)return -1;lua_settop(L,result-1);applied++;}return applied;}
EMSCRIPTEN_KEEPALIVE const char* script_last_error(){return script_error.c_str();}
EMSCRIPTEN_KEEPALIVE int script_command_count(){return script_commands.size();}
EMSCRIPTEN_KEEPALIVE const char* script_command_name(int i){return script_commands.at(i).name.c_str();}
EMSCRIPTEN_KEEPALIVE int script_command_arg_count(int i){return script_commands.at(i).args.size();}
EMSCRIPTEN_KEEPALIVE const char* script_command_arg(int i,int j){return script_commands.at(i).args.at(j).c_str();}
EMSCRIPTEN_KEEPALIVE void script_commands_clear(){script_commands.clear();}
EMSCRIPTEN_KEEPALIVE const float* event_matrix(int i){static glm::mat4 m;const auto& r=requests.at(i);const auto& f=*stage->file;auto trap=f.GetEntity(*r.condition->entity,"parent");auto center=f.GetBool(*r.callback->entity,"orderDemoCenter")?f.GetEntity(*r.callback->entity,"demoCenterLink"):nullptr;m=f.WorldTransform(center?*center:*trap);return glm::value_ptr(m);}
EMSCRIPTEN_KEEPALIVE const float* stage_next_matrix(){static glm::mat4 m;const auto& c=stage->connectors;if(!c.contains("startDoor")||!c.contains("endDoor"))return nullptr;m=c.at("endDoor")*glm::rotate(glm::mat4(1),glm::pi<float>(),glm::vec3(0,1,0))*glm::inverse(c.at("startDoor"));return glm::value_ptr(m);}
EMSCRIPTEN_KEEPALIVE void script_bgm_state(const char* name,int playing){script_bgm[name]=playing!=0;}
EMSCRIPTEN_KEEPALIVE int script_set_floor(const char* name){if(!name)return 0;for(const auto* floor:pt::game::kFloorNames)if(name==std::string(floor)){script_floor=name;photo_floor(script_floor);return 1;}return 0;}
EMSCRIPTEN_KEEPALIVE const char* script_next_floor(){for(size_t i=0;i+1<std::size(pt::game::kFloorNames);i++)if(script_floor==pt::game::kFloorNames[i])return pt::game::kFloorNames[i+1];return "";}
EMSCRIPTEN_KEEPALIVE void script_apply_geometry(){for(const auto& c:script_commands)if(c.name=="GeomActive")for(uint32_t owner=1;owner<owner_count;owner++)if(world.OwnerName(owner)==c.args[0])world.SetOwnerActive(owner,c.args[1]=="1");}
EMSCRIPTEN_KEEPALIVE int locator_count() {return stage->locators.size()+stage->game_objects.size();}
static const pt::game::LocatorPlacement& locator(int i) {return size_t(i)<stage->locators.size()?stage->locators.at(i):stage->game_objects.at(i-stage->locators.size());}
EMSCRIPTEN_KEEPALIVE const char* locator_name(int i) {return locator(i).name.c_str();}
EMSCRIPTEN_KEEPALIVE const float* locator_matrix(int i) {return glm::value_ptr(locator(i).world);}
EMSCRIPTEN_KEEPALIVE const float* lamp_locator(){if(!stage)return nullptr;const auto& f=*stage->file;for(const auto& l:stage->game_objects)if(l.class_name=="ShGimmick"){auto p=f.GetEntity(*l.entity,"parameters");if(p&&f.GetString(*p,"partsType")=="CeilLamp")return glm::value_ptr(l.world);}return nullptr;}
EMSCRIPTEN_KEEPALIVE void world_clear() {world.Clear();surfaces.clear();geom_owner=0;owner_count=1;}
EMSCRIPTEN_KEEPALIVE int world_owner_create(const char* name){const auto id=world.AddOwner(name?name:"");owner_count=id+1;return id;}
EMSCRIPTEN_KEEPALIVE int world_owner_select(int owner){if(owner<0||unsigned(owner)>=owner_count)return 0;geom_owner=owner;return 1;}
EMSCRIPTEN_KEEPALIVE const char* world_owner_triangles(int owner){static std::string result;std::ostringstream out;out<<"[";bool first=true;for(const auto& t:world.Triangles())if(t.owner==unsigned(owner)){if(!first)out<<",";first=false;out<<"[";for(int i=0;i<3;i++){const auto v=i==0?t.a:i==1?t.b:t.c;if(i)out<<",";out<<"["<<v.x<<","<<v.y<<","<<v.z<<"]";}out<<"]";}out<<"]";result=out.str();return result.c_str();}
EMSCRIPTEN_KEEPALIVE int world_add_geom(const uint8_t* data,int size,const float* matrix) {
 std::vector<pt::GeomTriangle> triangles; bool skipped=false, missing_movement=false;
 if(!pt::LoadGeom({data,size_t(size)}, {},triangles,&skipped,&missing_movement) || missing_movement) return -1;
  const auto before=world.Triangles().size(); world.AddTriangles(triangles,glm::make_mat4(matrix),0,geom_owner);
 return int(world.Triangles().size()-before);
}
EMSCRIPTEN_KEEPALIVE int world_surface_geom(const uint8_t* data,int size,const float* matrix,const float* positions,int count){
 if(size<=0||count<0||count>4000000)return -1;
 std::vector<glm::vec3> raw;raw.reserve(count);for(int i=0;i<count;i++)raw.emplace_back(positions[i*3],positions[i*3+1],positions[i*3+2]);
 std::vector<pt::GeomTriangle> triangles;if(!pt::LoadGeom({data,size_t(size)},raw,triangles))return -1;
 int total=0;for(const auto& t:triangles)if(t.material){pt::CollisionTriangle out;if(pt::CollisionWorld::MakeTriangle(t,glm::make_mat4(matrix),out)){surfaces.push_back({out,t.material,geom_owner});total++;}}return total;
}
EMSCRIPTEN_KEEPALIVE int world_build() {world.Build();return world.Triangles().size();}
EMSCRIPTEN_KEEPALIVE float world_floor(float x,float y,float z) {
 pt::RayHit hit; return world.Raycast({x,y,z},{0,-1,0},100,hit)?hit.point.y:-1000;
}
// Same surface-height window and area priority as Game::SurfaceMaterial/GameSound::AreaAt.
EMSCRIPTEN_KEEPALIVE uint32_t acoustic_surface(float x,float y,float z){
 float best=y-.6f;uint32_t material=0;
 for(const auto& s:surfaces){if(!world.OwnerActive(s.owner))continue;const auto& t=s.triangle;
 float d=(t.b.x-t.a.x)*(t.c.z-t.a.z)-(t.b.z-t.a.z)*(t.c.x-t.a.x);if(std::abs(d)<1e-8f)continue;
 float u=((t.b.x-x)*(t.c.z-z)-(t.b.z-z)*(t.c.x-x))/d,v=((t.c.x-x)*(t.a.z-z)-(t.c.z-z)*(t.a.x-x))/d,q=1-u-v;
 float h=u*t.a.y+v*t.b.y+q*t.c.y;if(u>=0&&v>=0&&q>=0&&h>best&&h<y+.4f){best=h;material=s.material;}}
 return material;
}
EMSCRIPTEN_KEEPALIVE int acoustic_blocked(float x,float y,float z,float tx,float ty,float tz){
 glm::vec3 p(x,y,z),delta=glm::vec3(tx,ty,tz)-p;float length=glm::length(delta);pt::RayHit hit;
 return std::isfinite(length)&&length>.1f&&world.Raycast(p+delta/length*.05f,delta/length,length-.1f,hit);
}
EMSCRIPTEN_KEEPALIVE int acoustic_area(float x,float y,float z){
 sound_area=nullptr;if(!stage)return 0;const auto& f=*stage->file;
 for(const auto& e:f.Entities())if(e.class_name=="SoundAreaGroup"){
  if(sound_area&&f.GetInt(e,"priority")>=f.GetInt(*sound_area,"priority"))continue;
  auto members=f.FindProperty(e,"members");bool inside=false;
  for(size_t i=0;members&&i<members->Count();i++){auto member=f.ElementEntity(*members,i);auto shapes=member?f.FindProperty(*member,"shapes"):nullptr;
   for(size_t j=0;shapes&&j<shapes->Count();j++){auto shape=f.ElementEntity(*shapes,j);if(!shape)continue;auto box=f.WorldTransform(*shape);if(std::abs(glm::determinant(box))<1e-12)continue;auto p=glm::vec3(glm::inverse(box)*glm::vec4(x,y,z,1));inside|=std::abs(p.x)<=.5f&&std::abs(p.y)<=.5f&&std::abs(p.z)<=.5f;}}
  if(inside)sound_area=&e;
 }
 auto parameter=sound_area?f.GetEntity(*sound_area,"parameter"):nullptr;auto sends=parameter?f.FindProperty(*parameter,"auxSends"):nullptr;return sends?sends->Count():0;
}
EMSCRIPTEN_KEEPALIVE const char* acoustic_area_name(){static std::string name;name=sound_area?stage->file->EntityName(*sound_area):"";return name.c_str();}
// Listener-area ambience and edge fades from GameSound::UpdateAreas.
EMSCRIPTEN_KEEPALIVE const char* acoustic_ambience(const char* previous){
 static std::string result;std::ostringstream out;const auto& f=*stage->file;
 const auto* p=sound_area?f.GetEntity(*sound_area,"parameter"):nullptr;
 const std::string name=sound_area?f.EntityName(*sound_area):"";float rate=1000;std::string volume="volumeRtpc";
 for(const auto& e:f.Entities()){
  if(e.class_name=="SoundAreaGlobal"){auto v=f.GetString(e,"volumeRtpc");if(!v.empty())volume=v;}
  if(e.class_name!="SoundAreaEdge")continue;
  auto a=f.GetEntity(e,"prevArea"),b=f.GetEntity(e,"nextArea");if(!a||!b)continue;
  auto an=f.EntityName(*a),bn=f.EntityName(*b);
  if((an==previous&&bn==name)||(bn==previous&&an==name)){
   auto ep=f.GetEntity(e,"parameter");rate=1000.f/(1+std::max(0,ep?f.GetInt(*ep,"fadeTime"):0));
  }
 }
 out<<"{\"name\":"<<std::quoted(name)<<",\"event\":"<<std::quoted(p?f.GetString(*p,"ambientEvent"):"")
 <<",\"rtpc\":"<<std::quoted(p?f.GetString(*p,"ambientRtpcName"):"")<<",\"value\":"<<(p?f.GetFloat(*p,"ambientRtpcValue"):0)
 <<",\"volume\":"<<std::quoted(volume)<<",\"rate\":"<<rate<<"}";result=out.str();return result.c_str();
}
// GameSound::OnStageLoaded / UpdateEmitters: original source and closest point on its boxes.
static std::vector<const pt::fox2::Entity*> fx_locators;
EMSCRIPTEN_KEEPALIVE int fx_locator_count(){fx_locators.clear();if(stage)for(const auto& e:stage->file->Entities())if(e.class_name=="FxLocatorData")fx_locators.push_back(&e);return fx_locators.size();}
EMSCRIPTEN_KEEPALIVE const char* fx_locator_path(int i){static std::string s;s=stage->file->GetString(*fx_locators.at(i),"vfxFile");return s.c_str();}
EMSCRIPTEN_KEEPALIVE const float* fx_locator_state(int i){static float v[7];const auto* e=fx_locators.at(i);const auto& f=*stage->file;auto m=f.WorldTransform(*e);auto forward=glm::normalize(glm::vec3(m[2]));for(int k=0;k<3;k++){v[k]=m[3][k];v[3+k]=forward[k];}auto it=model_visible.find(e);v[6]=BodyEnabled(e,f.GetBool(*e,"enable",0,true))&&(it==model_visible.end()?bool(f.GetUInt(*e,"flags",0,7)&1):it->second);return v;}
EMSCRIPTEN_KEEPALIVE int acoustic_source_count(){sound_sources.clear();if(stage)for(const auto& e:stage->file->Entities())if(e.class_name=="SoundSource")sound_sources.push_back(&e);return sound_sources.size();}
EMSCRIPTEN_KEEPALIVE const char* acoustic_source_event(int i){static std::string s;s=stage->file->GetString(*sound_sources.at(i),"eventName");return s.c_str();}
EMSCRIPTEN_KEEPALIVE const char* acoustic_source_name(int i){static std::string s;s=stage->file->EntityName(*sound_sources.at(i));return s.c_str();}
EMSCRIPTEN_KEEPALIVE const float* acoustic_source_data(int i,float x,float y,float z){
 static float v[7];const auto& f=*stage->file;const auto& e=*sound_sources.at(i);auto world=f.WorldTransform(e);glm::vec3 listener(x,y,z),position(world[3]),forward(world[2]);
 if(glm::length(forward)>1e-6f)forward=glm::normalize(forward);else forward={0,0,1};
 auto shapes=f.FindProperty(e,"shapes");float best=1e30f;
 for(size_t j=0;shapes&&j<shapes->Count();j++){auto s=f.ElementEntity(*shapes,j);if(!s)continue;auto box=f.WorldTransform(*s);if(std::abs(glm::determinant(box))<1e-12f)continue;
 auto local=glm::clamp(glm::vec3(glm::inverse(box)*glm::vec4(listener,1)),glm::vec3(-.5f),glm::vec3(.5f));auto p=glm::vec3(box*glm::vec4(local,1));float d=glm::length(p-listener);if(d<best){best=d;position=p;}}
 for(int j=0;j<3;j++){v[j]=position[j];v[j+3]=forward[j];}v[6]=f.GetFloat(e,"playRange",0,20);return v;
}
EMSCRIPTEN_KEEPALIVE const char* acoustic_bus(int i){static std::string bus;auto& f=*stage->file;auto p=f.GetEntity(*sound_area,"parameter");bus=f.KeyString(*f.FindProperty(*p,"auxSends"),i);return bus.c_str();}
EMSCRIPTEN_KEEPALIVE float acoustic_level(int i){auto& f=*stage->file;auto p=f.GetEntity(*sound_area,"parameter");float value;std::memcpy(&value,f.FindProperty(*p,"auxSends")->Element(i),4);return value;}
EMSCRIPTEN_KEEPALIVE void player_spawn(float x,float y,float z) {player.position={x,y,z};player.Reset();player_displacement=glm::vec3(0);player_elapsed=0;player_previous=player.BodyPosition();}
EMSCRIPTEN_KEEPALIVE const float* player_step(float dx,float dz,float dt) {
 // Match Player::UpdateBody: one collision solve per original 29.97 Hz frame.
 // Tiny 300 Hz casts are shorter than SweepOriginal's 8 mm backoff and can
 // permanently stick against an open door. Preserve the original capsule.
 if(dt>0 && dt<=0.02f){
  player_displacement+=glm::vec3(dx,0,dz);player_elapsed+=dt;
  constexpr float frame=1001.0f/30000.0f;
  if(player_elapsed>=frame){const glm::vec3 step=player_displacement*(frame/player_elapsed);player_previous=player.BodyPosition();player.Move(world,step,frame,frame);player_displacement-=step;player_elapsed-=frame;}
 }
 auto p=player.BodyPosition();output[0]=p.x;output[1]=p.y;output[2]=p.z;output[3]=player.grounded;return output;
}
EMSCRIPTEN_KEEPALIVE const float* player_draw_position(){
 static float draw[3];const auto current=player.BodyPosition();
 const auto p=glm::distance(current,player_previous)>.5f?current:
  glm::mix(player_previous,current,std::clamp(player_elapsed/(1001.0f/30000.0f),0.0f,1.0f));
 for(int i=0;i<3;i++)draw[i]=p[i];return draw;
}
}

#include "post_bridge.h"
