// The same non-rig GANI sampling as GimmickAnimation::SampleMotion/FireEvents.
#include <emscripten/emscripten.h>
#include <glm/gtc/type_ptr.hpp>
#include "engine/anim/gani.h"
#include "engine/anim/skeleton.h"
#include "engine/core/pathcode.h"
#include "engine/core/strcode.h"
#include <cstdlib>
namespace {
pt::anim::MotionArchive lampArchive;
pt::anim::Skeleton lampSkeleton;
const pt::anim::GaniMotion* lampMotion=nullptr;
std::vector<glm::mat4> lampWorld;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void lamp_clear(){lampMotion=nullptr;lampArchive={};lampSkeleton={};lampWorld.clear();}
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
EMSCRIPTEN_KEEPALIVE const float* lamp_bone(const char* code){uint64_t id=std::strtoull(code,nullptr,10);for(size_t i=0;i<lampWorld.size();i++)if((pt::StrCode64(lampSkeleton.names[i])&pt::kStrCode64Mask)==id)return glm::value_ptr(lampWorld[i]);return nullptr;}
}
