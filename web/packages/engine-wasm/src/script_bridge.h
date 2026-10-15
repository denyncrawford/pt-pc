// Small portable host for the original Lua scripts. Unsupported APIs fail the call;
// they are never acknowledged as completed events.
#include "engine/script/lua_vm.h"
#include <array>
#include <glm/gtc/quaternion.hpp>
static std::unique_ptr<pt::LuaVm> script_vm;
static std::unordered_map<const pt::fox2::Entity*,bool> body_enabled;
static std::unordered_map<std::string,bool> script_bgm;
static int script_loop_count=1;
static int ScriptLoopCount(lua_State* L){lua_pushinteger(L,script_loop_count);return 1;}
static std::string script_error,script_floor="f010";
struct ScriptCommand { std::string name;std::vector<std::string> args; };
static std::vector<ScriptCommand> script_commands;
struct ScriptEntity {const pt::fox2::Entity* entity;bool body;};
static void PushScriptEntity(lua_State* L,const pt::fox2::Entity* e,bool body=false){
 if(!e){lua_pushnil(L);return;}auto* ref=static_cast<ScriptEntity*>(lua_newuserdata(L,sizeof(ScriptEntity)));*ref={e,body};luaL_getmetatable(L,"PT.Entity");lua_setmetatable(L,-2);
}
static ScriptEntity* ScriptRef(lua_State* L,int i=1){return static_cast<ScriptEntity*>(luaL_checkudata(L,i,"PT.Entity"));}
static bool BodyEnabled(const pt::fox2::Entity* e,bool fallback){auto it=body_enabled.find(e);return it==body_enabled.end()?fallback:it->second;}
static int ScriptBody(lua_State* L){PushScriptEntity(L,ScriptRef(L)->entity,true);return 1;}
static int ScriptKind(lua_State* L){const auto* r=ScriptRef(L);const std::string type=luaL_checkstring(L,2);lua_pushboolean(L,type==r->entity->class_name||(r->body&&type==r->entity->class_name+"Body"));return 1;}
static int ScriptNull(lua_State* L){lua_pushboolean(L,lua_isnil(L,1));return 1;}
static int ScriptLog(lua_State*){return 0;}
static int ScriptFloor(lua_State* L){lua_pushboolean(L,script_floor==luaL_checkstring(L,1));return 1;}
static void PushVec(lua_State* L,glm::vec3 v){lua_newtable(L);const char* keys[]={"x","y","z"};for(int k=0;k<3;k++){lua_pushnumber(L,v[k]);lua_setfield(L,-2,keys[k]);}}
static int ScriptVector(lua_State* L){PushVec(L,{luaL_optnumber(L,1,0),luaL_optnumber(L,2,0),luaL_optnumber(L,3,0)});return 1;}
static int ScriptTransform(lua_State* L){
 const auto m=stage->file->WorldTransform(*ScriptRef(L)->entity);const auto q=glm::quat_cast(glm::mat3(m));
 lua_newtable(L);PushVec(L,glm::vec3(m[3]));lua_setfield(L,-2,"translation");
 PushVec(L,{q.x,q.y,q.z});lua_pushnumber(L,q.w);lua_setfield(L,-2,"w");lua_setfield(L,-2,"rotQuat");PushVec(L,{glm::length(glm::vec3(m[0])),glm::length(glm::vec3(m[1])),glm::length(glm::vec3(m[2]))});lua_setfield(L,-2,"scale");return 1;
}
static int ScriptDemoTransform(lua_State* L){
 ScriptCommand c{"SetDemoTransform",{luaL_checkstring(L,1)}};
 for(int i=2;i<=3;i++){luaL_checktype(L,i,LUA_TTABLE);for(const char* k:{"x","y","z","w"}){if(i==3&&std::string(k)=="w")continue;lua_getfield(L,i,k);c.args.push_back(std::to_string(luaL_checknumber(L,-1)));lua_pop(L,1);}}
 script_commands.push_back(std::move(c));return 0;
}

static int ScriptChildren(lua_State* L){const auto* e=ScriptRef(L)->entity;const auto& f=*stage->file;lua_newtable(L);auto p=f.FindProperty(*e,"children");for(size_t i=0;p&&i<p->Count();i++){auto child=f.ElementEntity(*p,i);if(!child)continue;PushScriptEntity(L,child);lua_setfield(L,-2,f.EntityName(*child).c_str());}return 1;}
static void PushScriptElement(lua_State* L,const pt::fox2::Entity& e,const pt::fox2::Property& p,size_t i){
 const auto& f=*stage->file;using D=pt::fox2::DataType;
 switch(p.type){case D::String:case D::Path:case D::FilePtr:lua_pushstring(L,f.ElementString(p,i).c_str());break;case D::EntityPtr:case D::EntityHandle:case D::EntityLink:PushScriptEntity(L,f.ElementEntity(p,i));break;case D::Bool:lua_pushboolean(L,f.GetBool(e,p.name,i));break;case D::Float:lua_pushnumber(L,f.GetFloat(e,p.name,i));break;case D::Vector3:PushVec(L,glm::vec3(f.GetVec4(e,p.name,i)));break;default:lua_pushnumber(L,f.GetInt(e,p.name,i));break;}
}
static int ScriptVisible(lua_State* L){model_visible[ScriptRef(L)->entity]=lua_toboolean(L,lua_upvalueindex(1));return 0;}
static int ScriptObjectId(lua_State* L){const std::string type=luaL_checkstring(L,1),name=luaL_checkstring(L,2);
 if(type=="ShPlayer"&&name=="Player"){auto* ref=static_cast<ScriptEntity*>(lua_newuserdata(L,sizeof(ScriptEntity)));*ref={nullptr,false};luaL_getmetatable(L,"PT.Entity");lua_setmetatable(L,-2);return 1;}
 // Native ShGimmick IDs use the registered parts type, not the FOX2 entity name.
 if(type=="ShGimmick")for(const auto& locator:stage->game_objects)if(locator.class_name==type){const auto* parameters=stage->file->GetEntity(*locator.entity,"parameters");if(parameters&&stage->file->GetString(*parameters,"partsType")==name){PushScriptEntity(L,locator.entity);return 1;}}
for(const auto& e:stage->file->Entities())if(stage->file->GetString(e,"name")==name){PushScriptEntity(L,&e);return 1;}lua_pushnil(L);return 1;}
static int ScriptObjectCommand(lua_State* L){auto* e=ScriptRef(L);lua_getfield(L,2,"id");const std::string id=luaL_checkstring(L,-1);lua_pop(L,1);if(!e->entity){
 if(id=="SetDisableLeftStick"||id=="UnsetDisableLeftStick"){script_commands.push_back({"MovementLock",{id=="SetDisableLeftStick"?"1":"0"}});return 0;}
 return luaL_error(L,"Unsupported player command: %s",id.c_str());
 }if(id=="PlayMotion"){
 const auto* params=stage->file->GetEntity(*e->entity,"parameters");
 const auto type=params?stage->file->GetString(*params,"partsType"):"";
 if(type!="Baby")return luaL_error(L,"Unsupported motion target");
 lua_getfield(L,2,"motionKey");const std::string key=luaL_checkstring(L,-1);lua_pop(L,1);
 lua_getfield(L,2,"returnToIdle");const bool idle=lua_isnil(L,-1)||lua_toboolean(L,-1);lua_pop(L,1);
 script_commands.push_back({"BabyMotion",{key,idle?"1":"0"}});return 0;
 }if(id!="StageLight")return luaL_error(L,"Unsupported GameObject command: %s",id.c_str());lua_getfield(L,2,"switch");body_enabled[e->entity]=lua_toboolean(L,-1);lua_pop(L,1);return 0;}
static int ScriptGet(lua_State* L){
 const auto* r=ScriptRef(L);const std::string key=luaL_checkstring(L,2);const auto& f=*stage->file;
 if(key=="Visible"||key=="Invisible"){lua_pushboolean(L,key=="Visible");lua_pushcclosure(L,ScriptVisible,1);}
 else if(key=="GetDataBodyWithReferrer"||key=="GetDataBody")lua_pushcfunction(L,ScriptBody);
 else if(key=="IsKindOf")lua_pushcfunction(L,ScriptKind);
 else if(key=="GetChildren")lua_pushcfunction(L,ScriptChildren);
 else if(key=="worldTransform")return ScriptTransform(L);
 else if(key=="GetWorldTransform")lua_pushcfunction(L,ScriptTransform);
 else if(key=="SetupMessageBox")lua_pushcfunction(L,ScriptLog); // listeners are queried live, no cached subscriptions
 else if(r->body&&key=="enable")lua_pushboolean(L,BodyEnabled(r->entity,f.GetBool(*r->entity,"enable",0,true)));
 else if(r->body&&key=="isVisible")lua_pushboolean(L,model_visible.contains(r->entity)?model_visible[r->entity]:f.GetBool(*r->entity,"isVisible",0,true));
 else if(const auto* p=f.FindProperty(*r->entity,key)){
  if(p->container==pt::fox2::Container::StaticArray&&p->Count()==1)PushScriptElement(L,*r->entity,*p,0);
  else{lua_newtable(L);for(size_t i=0;i<p->Count();i++){PushScriptElement(L,*r->entity,*p,i);if(p->container==pt::fox2::Container::StringMap)lua_setfield(L,-2,f.KeyString(*p,i).c_str());else lua_rawseti(L,-2,i+1);}}
 }else lua_pushnil(L);return 1;
}
static int ScriptSet(lua_State* L){
 auto* r=ScriptRef(L);if(!r->body)return luaL_error(L,"Read-only entity");const std::string key=luaL_checkstring(L,2);const bool value=lua_toboolean(L,3);const auto name=stage->file->EntityName(*r->entity);
 if(key=="enable")body_enabled[r->entity]=value;
 else if(key=="isVisible")model_visible[r->entity]=value;
 else if(key=="isGeomActive"){script_commands.push_back({"GeomActive",{name,value?"1":"0"}});}
 else return luaL_error(L,"Unsupported body property: %s",key.c_str());return 0;
}
static int ScriptCommandCall(lua_State* L){ScriptCommand c;c.name=lua_tostring(L,lua_upvalueindex(1));for(int i=1;i<=lua_gettop(L);i++){if(lua_isstring(L,i))c.args.emplace_back(lua_tostring(L,i));else if(lua_isboolean(L,i))c.args.emplace_back(lua_toboolean(L,i)?"1":"0");else if(lua_istable(L,i)){for(const char* k:{"x","y","z"}){lua_getfield(L,i,k);c.args.push_back(std::to_string(lua_tonumber(L,-1)));lua_pop(L,1);}}else return luaL_error(L,"Unsupported command argument");}script_commands.push_back(std::move(c));return 0;}
static int ScriptBgmPlaying(lua_State* L){lua_pushboolean(L,script_bgm[luaL_checkstring(L,1)]);return 1;}
static int ScriptBgmCommand(lua_State* L){const std::string name=luaL_checkstring(L,1),kind=lua_tostring(L,lua_upvalueindex(1));const bool stop=kind=="StopBGM";script_bgm[stop&&name.starts_with("Stop_")?"Play_"+name.substr(5):name]=!stop;return ScriptCommandCall(L);}
static void ScriptBudget(lua_State* L,lua_Debug*){luaL_error(L,"Script exceeded instruction budget");}
static void ScriptRegister(lua_State* L,const char* module,const char* key,lua_CFunction fn){lua_getglobal(L,module);if(!lua_istable(L,-1)){lua_pop(L,1);lua_newtable(L);lua_pushvalue(L,-1);lua_setglobal(L,module);}lua_pushcfunction(L,fn);lua_setfield(L,-2,key);lua_pop(L,1);}
static void ScriptRegisterCommand(lua_State* L,const char* module,const char* key){lua_getglobal(L,module);if(!lua_istable(L,-1)){lua_pop(L,1);lua_newtable(L);lua_pushvalue(L,-1);lua_setglobal(L,module);}lua_pushstring(L,key);lua_pushcclosure(L,ScriptCommandCall,1);lua_setfield(L,-2,key);lua_pop(L,1);}
static void ResetScriptHost(){
 script_vm=std::make_unique<pt::LuaVm>();auto* L=script_vm->State();body_enabled.clear();script_commands.clear();script_error.clear();script_bgm.clear();script_floor="f010";script_loop_count=1;
 for(const char* name:{"os","io","package","require","dofile","loadfile","debug"}){lua_pushnil(L);lua_setglobal(L,name);}
 luaL_newmetatable(L,"PT.Entity");lua_pushcfunction(L,ScriptGet);lua_setfield(L,-2,"__index");lua_pushcfunction(L,ScriptSet);lua_setfield(L,-2,"__newindex");lua_pop(L,1);
 ScriptRegister(L,"GameObject","GetGameObjectId",ScriptObjectId);ScriptRegister(L,"GameObject","SendCommand",ScriptObjectCommand);
 ScriptRegister(L,"Fox","Log",ScriptLog);ScriptRegister(L,"Entity","IsNull",ScriptNull);ScriptRegister(L,"GameFloorLevel","IsCurrentFloorName",ScriptFloor);ScriptRegister(L,"GameFloorLevel","GetLoopCount",ScriptLoopCount);
 lua_pushcfunction(L,ScriptVector);lua_setglobal(L,"Vector3");
 for(const char* name:{"LoadStage","ActivateStage","ChangeStageId","UnloadStage"})ScriptRegisterCommand(L,"ShGameMainControl",name);
 ScriptRegisterCommand(L,"DemoDaemon","Play");ScriptRegister(L,"DemoDaemon","SetDemoTransform",ScriptDemoTransform);
 ScriptRegisterCommand(L,"ShDemo","Skip");ScriptRegisterCommand(L,"ShNazoManager","SetCondition");
 ScriptRegister(L,"GameSystem","IsPlayingBGM",ScriptBgmPlaying);
 for(const char* name:{"CallBGM","StopBGM"}){ScriptRegisterCommand(L,"GameSystem",name);lua_getglobal(L,"GameSystem");lua_pushstring(L,name);lua_pushcclosure(L,ScriptBgmCommand,1);lua_setfield(L,-2,name);lua_pop(L,1);}
 ScriptRegisterCommand(L,"GameSystem","SoundPostEvent");ScriptRegisterCommand(L,"GameController","VisibleControlSubtitle");ScriptRegisterCommand(L,"GameController","ChangeGameStep");
}
