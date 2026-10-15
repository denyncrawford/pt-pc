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

pt::anim::MotionArchive babyArchive;
pt::anim::Skeleton babySkeleton;
const pt::anim::GaniMotion* babyMotion=nullptr;
std::vector<glm::mat4> babyWorld, babySkin;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void baby_clear(){babyMotion=nullptr;babyArchive={};babySkeleton={};babyWorld.clear();babySkin.clear();}
EMSCRIPTEN_KEEPALIVE int baby_archive(const uint8_t* bytes,int size){if(size<=0||size>128*1024*1024)return 0;babyMotion=nullptr;std::string error;return babyArchive.Parse({bytes,bytes+size},&error);}
EMSCRIPTEN_KEEPALIVE int baby_model(const uint8_t* bytes,int size){return size>0&&size<32*1024*1024&&pt::anim::ReadFmdlSkeleton({bytes,size_t(size)},babySkeleton);}
EMSCRIPTEN_KEEPALIVE int baby_motion(const char* path){babyMotion=babyArchive.Find(pt::PathCode64(path));return babyMotion&&!babyMotion->RigDriven();}
EMSCRIPTEN_KEEPALIVE int baby_sample(double frame){
 if(!babyMotion||babySkeleton.Empty()||!std::isfinite(frame)||frame<0)return 0;
 pt::anim::Pose pose;pose.Reset(babySkeleton.Size());double f=babyMotion->WrapFrame(frame,babyMotion->Loops());
 for(const auto& unit:babyMotion->units){if(unit.hash==pt::anim::kHashModelRootUnit)continue;int b=babySkeleton.Find(unit.hash);if(b<0)continue;
  if(unit.rotation>=0)pose.rotation[b]=pt::anim::ToQuat(babyMotion->Sample(unit,unit.rotation,f));
  if(unit.translation>=0)pose.offset[b]=glm::vec3(babyMotion->Sample(unit,unit.translation,f));
 }
 pt::anim::ComputeBoneWorld(babySkeleton,pose,babyWorld);return babyWorld.size();
}
EMSCRIPTEN_KEEPALIVE const float* baby_skin(){pt::anim::ComputeSkin(babySkeleton,babyWorld,babySkin);return babySkin.empty()?nullptr:glm::value_ptr(babySkin[0]);}
EMSCRIPTEN_KEEPALIVE int baby_bone_count(){return babySkeleton.Size();}
EMSCRIPTEN_KEEPALIVE const float* baby_bone(const char* code){uint64_t id=std::strtoull(code,nullptr,10);for(size_t i=0;i<babyWorld.size();i++)if((pt::StrCode64(babySkeleton.names[i])&pt::kStrCode64Mask)==id)return glm::value_ptr(babyWorld[i]);return nullptr;}
}
