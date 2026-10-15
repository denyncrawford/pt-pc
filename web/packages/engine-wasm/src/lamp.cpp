// The same non-rig GANI sampling as GimmickAnimation::SampleMotion/FireEvents.
#include <emscripten/emscripten.h>
#include <glm/gtc/type_ptr.hpp>
#include "engine/anim/gani.h"
#include "engine/anim/skeleton.h"
#include "engine/core/pathcode.h"
#include "engine/core/strcode.h"
#include <cstdlib>
#include <glm/gtc/matrix_transform.hpp>
#include "engine/data/fox2.h"
#include "engine/vfx/vfx_system.h"
#include "engine/render/scene_lighting.h"
namespace {
void clearLampEffects();
pt::anim::MotionArchive lampArchive;
pt::anim::Skeleton lampSkeleton;
const pt::anim::GaniMotion* lampMotion=nullptr;
std::vector<glm::mat4> lampWorld, lampSkin;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void lamp_clear(){clearLampEffects();lampMotion=nullptr;lampArchive={};lampSkeleton={};lampWorld.clear();lampSkin.clear();}
EMSCRIPTEN_KEEPALIVE int lamp_archive(const uint8_t* bytes,int size){if(size<=0||size>128*1024*1024)return 0;lampMotion=nullptr;std::string error;return lampArchive.Parse({bytes,bytes+size},&error);}
EMSCRIPTEN_KEEPALIVE int lamp_model(const uint8_t* bytes,int size){return size>0&&size<32*1024*1024&&pt::anim::ReadFmdlSkeleton({bytes,size_t(size)},lampSkeleton);}
EMSCRIPTEN_KEEPALIVE int lamp_motion(const char* path){lampMotion=lampArchive.Find(pt::PathCode64(path));return lampMotion&&!lampMotion->RigDriven();}
EMSCRIPTEN_KEEPALIVE int lamp_sample(double frame){
 if(!lampMotion||lampSkeleton.Empty()||!std::isfinite(frame)||frame<0)return 0;
 pt::anim::Pose pose;pose.Reset(lampSkeleton.Size());double f=lampMotion->WrapFrame(frame,lampMotion->Loops());
 for(const auto& unit:lampMotion->units){if(unit.hash==pt::anim::kHashModelRootUnit)continue;int b=lampSkeleton.Find(unit.hash);if(b<0)continue;
  if(unit.rotation>=0)pose.rotation[b]=pt::anim::ToQuat(lampMotion->Sample(unit,unit.rotation,f));
  if(unit.translation>=0)pose.offset[b]=glm::vec3(lampMotion->Sample(unit,unit.translation,f));
 }
 pt::anim::ComputeBoneWorld(lampSkeleton,pose,lampWorld);return lampWorld.size();
}
EMSCRIPTEN_KEEPALIVE const float* lamp_skin(){pt::anim::ComputeSkin(lampSkeleton,lampWorld,lampSkin);return lampSkin.empty()?nullptr:glm::value_ptr(lampSkin[0]);}
EMSCRIPTEN_KEEPALIVE int lamp_bone_count(){return lampSkeleton.Size();}
EMSCRIPTEN_KEEPALIVE const float* lamp_bone(const char* code){uint64_t id=std::strtoull(code,nullptr,10);for(size_t i=0;i<lampWorld.size();i++)if((pt::StrCode64(lampSkeleton.names[i])&pt::kStrCode64Mask)==id)return glm::value_ptr(lampWorld[i]);return nullptr;}
}
// Lamp effects own their simulator: resetting scene FxLocators must not retire the lamp.
namespace {
pt::vfx::System lampEffects;
std::map<std::string,std::vector<uint8_t>> lampEffectFiles;
std::string lampEffectPath, lampEffectBone;
glm::vec3 lampEffectOffset(0);
uint32_t lampEffectSeed=0, lampEffectKind=0;
glm::vec4 lampEffectGeneral(0);
bool lampEffectSpawned=false;
float lampLight[28]{};
void clearLampEffects(){lampEffects.Clear();lampEffects.ClearCache();lampEffectFiles.clear();lampEffectSpawned=false;}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE const char* lamp_effect_parts(const uint8_t* bytes,int size){
 pt::fox2::DataSetFile file;
 if(size<=0||!file.Load("lamp.parts",{bytes,bytes+size}))return nullptr;
 for(const auto& e:file.Entities())if(e.class_name=="EffectDescription"&&file.GetString(e,"partName")=="CeilLampFlareLight"){
  auto targets=file.FindProperty(e,"connectDestinationSkelNames");
  if(!targets||targets->Count()!=1||file.GetUInt(e,"effectKind")>2)return nullptr;
  lampEffectKind=file.GetUInt(e,"effectKind");
  lampEffectGeneral=file.GetVec4(e,"generalSkelParameters",0);
  lampEffectBone=file.ElementString(*targets,0);
  lampEffectOffset=glm::vec3(file.GetVec4(e,"offsetSkelPositions",0));
  lampEffectSeed=file.GetUInt(e,"effectRandomSeed");
  lampEffectPath=file.GetString(e,"effectFileFromFilePtr");
  if(lampEffectPath.empty())lampEffectPath=file.GetString(e,"effectFileFromVfxFileLoader");
  return lampEffectPath.c_str();
 }
 return nullptr;
}
EMSCRIPTEN_KEEPALIVE int lamp_effect_load(const uint8_t* bytes,int size){
 if(size<=0||size>32*1024*1024)return 0;
 lampEffects.Clear();lampEffects.ClearCache();lampEffectSpawned=false;
 lampEffectFiles[lampEffectPath].assign(bytes,bytes+size);
 lampEffects.SetReader([](const std::string& path)->std::optional<std::vector<uint8_t>>{auto it=lampEffectFiles.find(path);if(it!=lampEffectFiles.end())return it->second;return std::nullopt;});
 return 1;
}
EMSCRIPTEN_KEEPALIVE int lamp_effect_dependency(const char* path,const uint8_t* bytes,int size){
 if(!path||size<=0||size>32*1024*1024)return 0;lampEffectFiles[path].assign(bytes,bytes+size);return 1;
}
EMSCRIPTEN_KEEPALIVE const float* lamp_effect_sample(const float* world,float dt){
 if(!world||!std::isfinite(dt)||dt<0||dt>.25f)return nullptr;
 int bone=lampSkeleton.FindName(lampEffectBone);
 if(bone<0||size_t(bone)>=lampWorld.size())return nullptr;
 auto matrix=glm::make_mat4(world)*lampWorld[bone]*glm::translate(glm::mat4(1),lampEffectOffset);
 if(lampEffectKind==2)matrix*=glm::mat4_cast(glm::quat(lampEffectGeneral.w,lampEffectGeneral.x,lampEffectGeneral.y,lampEffectGeneral.z));
 else if(lampEffectKind==1)matrix[3]+=glm::vec4(glm::vec3(lampEffectGeneral),0);
 if(!lampEffectSpawned){if(!lampEffects.Spawn({1,1},lampEffectPath,matrix,lampEffectSeed))return nullptr;lampEffectSpawned=true;dt=std::max(dt,1.0f/60);}
 else lampEffects.SetTransform({1,1},matrix);
 pt::vfx::ViewInfo view;
 lampEffects.Update(dt,view);
 pt::vfx::RenderList render;std::vector<pt::vfx::LightOut> lights;
 auto texture=[](const std::string&){return pt::vfx::kNoTexture;};
 lampEffects.Build(view,texture,texture,{},render,lights);
 if(lights.size()!=1)return nullptr;
 const auto& l=lights[0];const float pi=3.14159265358979323846f;
 const float umbra=std::clamp(l.umbra,1.0f,179.0f), penumbra=std::clamp(l.penumbra,0.0f,umbra);
 auto rgb=pt::light_math::ColorFromTemperature(l.temperature,0,l.lumen,l.color);
 rgb/= l.spot?pt::light_math::SpotSolidAngle(umbra,penumbra,l.attenuation)*pi:4*pi*pi;
 std::fill(std::begin(lampLight),std::end(lampLight),0);
 for(int k=0;k<3;k++){lampLight[k]=l.position[k];lampLight[4+k]=rgb[k];lampLight[8+k]=l.direction[k];}
 lampLight[3]=std::max(.01f,l.outer_range);
 lampLight[11]=l.spot?cos(umbra*pi/360):-1;
 lampLight[12]=l.spot?cos(penumbra*pi/360):-1;
 lampLight[13]=l.attenuation;lampLight[14]=l.inner_range;
 lampLight[15]=l.shadow&&l.spot;lampLight[16]=1;lampLight[17]=l.specular;lampLight[18]=l.lumen;
 lampLight[20]=l.shadow_bias;lampLight[21]=l.view_bias;lampLight[22]=1;
 lampLight[23]=l.spot?cos(l.shadow_umbra*pi/360):-1;
 lampLight[24]=1/std::max(.00001f,float(cos(l.shadow_penumbra*pi/360))-lampLight[23]);
 return lampLight;
}
}
