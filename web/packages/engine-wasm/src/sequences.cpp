// Portable sequence decoder. Uses the native stream/track readers, not a JS timeline.
#include <emscripten/emscripten.h>
#include <glm/gtc/type_ptr.hpp>
#include "engine/anim/demo_file.h"
#include "engine/data/fox2.h"
#include "engine/anim/skeleton.h"
#include "engine/core/strcode.h"
#include <glm/gtc/matrix_transform.hpp>
#include <string>
#include <vector>
#include <memory>
#include <cmath>
#include <algorithm>
#include <map>
#include <limits>
#include <malloc.h>
namespace {
struct SequenceState {
 std::unique_ptr<pt::anim::DemoStreamFile> stream;
 std::vector<pt::anim::DecodedTrack> tracks;
 std::vector<const pt::anim::StreamEvent*> events;
 size_t bytes=0;
 std::map<std::string,pt::anim::Skeleton> skeletons;
};
SequenceState legacy;
std::map<int,std::unique_ptr<SequenceState>> instances;
int selected=0,nextHandle=1;
SequenceState& current(){return selected?*instances.at(selected):legacy;}
size_t residentBytes(){size_t n=legacy.bytes;for(const auto& [id,s]:instances)n+=s->bytes;return n;}
std::string error;
std::vector<glm::mat4> modelSkin;
pt::anim::Skeleton playerSkeleton;std::vector<glm::mat4> playerSkin;
}
extern "C" {
// Decode transactionally: malformed input must not invalidate another playing demo.
EMSCRIPTEN_KEEPALIVE int sequence_load(const uint8_t* bytes,int size){
 error.clear();if(size<=0||size>128*1024*1024){error="Sequence size is invalid";return 0;}
 SequenceState next;next.stream=std::make_unique<pt::anim::DemoStreamFile>();
 if(!next.stream->Parse(std::vector<uint8_t>(bytes,bytes+size),&error))return 0;
 if(next.stream->Length()>108000||next.stream->Tracks().size()>10000){error="Sequence exceeds playback limits";return 0;}
 next.bytes=size;
 next.tracks.resize(next.stream->Tracks().size());
 for(size_t i=0;i<next.tracks.size();i++){
  if(next.stream->Tracks()[i].valid&&!next.stream->DecodeTrack(i,next.stream->Length(),next.tracks[i])){error="Sequence track decode failed";return 0;}
  next.bytes+=next.tracks[i].keys.capacity()*sizeof(pt::anim::Key)+next.tracks[i].blocks.capacity()*sizeof(pt::anim::TrackBlock);
  if(residentBytes()-current().bytes+next.bytes>128*1024*1024){error="Concurrent sequences exceed memory budget";return 0;}
 }
 next.events=next.stream->FirstLoopEvents();current()=std::move(next);return current().stream->Length();
}
EMSCRIPTEN_KEEPALIVE int sequence_create(const uint8_t* bytes,int size){
 if(instances.size()>=32||nextHandle==std::numeric_limits<int>::max()){error="Too many concurrent sequences";return 0;}
 const int previous=selected,id=nextHandle++;instances[id]=std::make_unique<SequenceState>();selected=id;
 const int frames=sequence_load(bytes,size);selected=previous;
 if(!frames){instances.erase(id);return 0;}return id;
}
EMSCRIPTEN_KEEPALIVE int sequence_select(int id){if(id!=0&&!instances.contains(id))return 0;selected=id;return 1;}
EMSCRIPTEN_KEEPALIVE int sequence_selected(){return selected;}
EMSCRIPTEN_KEEPALIVE int sequence_release(int id){if(id<=0||!instances.contains(id))return 0;if(selected==id)selected=0;instances.erase(id);return 1;}
EMSCRIPTEN_KEEPALIVE int sequence_live_heap_bytes(){return mallinfo().uordblks;}
EMSCRIPTEN_KEEPALIVE int sequence_instance_count(){return instances.size();}
EMSCRIPTEN_KEEPALIVE int sequence_resident_bytes(){return residentBytes();}
EMSCRIPTEN_KEEPALIVE int sequence_length(){return current().stream?current().stream->Length():0;}
EMSCRIPTEN_KEEPALIVE int sequence_player_skeleton(const uint8_t* bytes,int size){return size>0&&size<32*1024*1024&&pt::anim::ReadFmdlSkeleton({bytes,size_t(size)},playerSkeleton);}
EMSCRIPTEN_KEEPALIVE int sequence_bind_model(const char* name,const uint8_t* bytes,int size){
 if(!name||size<=0||size>32*1024*1024||(!current().skeletons.contains(name)&&current().skeletons.size()>=256))return 0;
 pt::anim::Skeleton next;if(!pt::anim::ReadFmdlSkeleton({bytes,size_t(size)},next)||next.Size()>256)return 0;current().skeletons[name]=std::move(next);return 1;
}
EMSCRIPTEN_KEEPALIVE int sequence_model_skin(const char* name,float frame,const float* origin){
 auto it=current().skeletons.find(name);if(it==current().skeletons.end())return 0;const auto& modelSkeleton=it->second;
 if(!current().stream||modelSkeleton.Empty()||!std::isfinite(frame))return 0;
 frame=std::clamp(frame,1.f,std::max(1.f,float(current().stream->Length())-2.f));const auto si=current().stream->FindActor(pt::anim::ActorKind::Skeleton,name),ri=current().stream->FindActor(pt::anim::ActorKind::ModelRoot,name);if(si<0||ri<0)return 0;
 pt::anim::Pose pose;pose.Reset(modelSkeleton.Size());glm::vec4 v;
 for(const auto& u:current().stream->Actors()[si].units){const int bone=modelSkeleton.Find(u.hash);if(bone<0)continue;if(u.rotation>=0&&current().tracks[u.rotation].Sample(frame,v))pose.rotation[bone]=glm::quat(v.w,v.x,v.y,v.z);if(u.translation>=0&&current().tracks[u.translation].Sample(frame,v))pose.offset[bone]=glm::vec3(v);}
 std::vector<glm::mat4> world;pt::anim::ComputeBoneWorld(modelSkeleton,pose,world);pt::anim::ComputeSkin(modelSkeleton,world,modelSkin);
 glm::vec3 translation(0);glm::quat rotation(1,0,0,0);const auto& root=current().stream->Actors()[ri].units.at(0);
 if(root.rotation>=0&&current().tracks[root.rotation].Sample(frame,v))rotation=glm::quat(v.w,v.x,v.y,v.z);if(root.translation>=0&&current().tracks[root.translation].Sample(frame,v))translation=glm::vec3(v);
 const auto transform=glm::make_mat4(origin)*glm::translate(glm::mat4(1),translation)*glm::mat4_cast(rotation);for(auto& m:modelSkin)m=transform*m;return modelSkin.size();
}
EMSCRIPTEN_KEEPALIVE const float* sequence_model_skin_ptr(){return modelSkin.empty()?nullptr:glm::value_ptr(modelSkin[0]);}
EMSCRIPTEN_KEEPALIVE int sequence_player_skin(float frame,const float* origin){
 if(!current().stream||playerSkeleton.Empty()||!std::isfinite(frame))return 0;
 frame=std::clamp(frame,1.f,std::max(1.f,float(current().stream->Length())-2.f));const auto si=current().stream->FindActor(pt::anim::ActorKind::Skeleton,"HM_plr0_main0_def"),ri=current().stream->FindActor(pt::anim::ActorKind::ModelRoot,"HM_plr0_main0_def");if(si<0||ri<0)return 0;
 pt::anim::Pose pose;pose.Reset(playerSkeleton.Size());glm::vec4 v;
 for(const auto& u:current().stream->Actors()[si].units){const int bone=playerSkeleton.Find(u.hash);if(bone<0)continue;if(u.rotation>=0&&current().tracks[u.rotation].Sample(frame,v))pose.rotation[bone]=glm::quat(v.w,v.x,v.y,v.z);if(u.translation>=0&&current().tracks[u.translation].Sample(frame,v))pose.offset[bone]=glm::vec3(v);}
 std::vector<glm::mat4> world;pt::anim::ComputeBoneWorld(playerSkeleton,pose,world);pt::anim::ComputeSkin(playerSkeleton,world,playerSkin);
 glm::vec3 translation(0);glm::quat rotation(1,0,0,0);const auto& root=current().stream->Actors()[ri].units.at(0);
 if(root.rotation>=0&&current().tracks[root.rotation].Sample(frame,v))rotation=glm::quat(v.w,v.x,v.y,v.z);if(root.translation>=0&&current().tracks[root.translation].Sample(frame,v))translation=glm::vec3(v);
 const auto transform=glm::make_mat4(origin)*glm::translate(glm::mat4(1),translation)*glm::mat4_cast(rotation);for(auto& m:playerSkin)m=transform*m;return playerSkin.size();
}
EMSCRIPTEN_KEEPALIVE const float* sequence_player_skin_ptr(){return playerSkin.empty()?nullptr:glm::value_ptr(playerSkin[0]);}
EMSCRIPTEN_KEEPALIVE int sequence_player_group(float frame,const char* name){
 if(!current().stream)return 0;const auto code=pt::StrCode64(name)&pt::kStrCode64Mask;bool model=false,visible=std::string(name)!="MESH_arm";
 for(const auto* e:current().events){if(e->Start()>frame)continue;
  if(e->functor==0xBFA41F9E6521ull){model=true;if((e->String(0x5366B1F9)&pt::kStrCode64Mask)==code)visible=e->Bool(0x517DBD2A,true);}
  else if(e->type==pt::anim::kEventVisibleMesh&&(e->StringArg(0)&pt::kStrCode64Mask)==(pt::StrCode64("HM_plr0_main0_def")&pt::kStrCode64Mask)&&(e->StringArg(1)&pt::kStrCode64Mask)==code)visible=e->ints.empty()||e->ints[0]!=0;
 }return model&&visible;
}
EMSCRIPTEN_KEEPALIVE uint64_t sequence_event_arg(int i,int arg){if(i<0||size_t(i)>=current().events.size()||arg<0)return 0;return current().events[i]->StringArg(arg);}
EMSCRIPTEN_KEEPALIVE int sequence_event_enabled(int i){if(i<0||size_t(i)>=current().events.size())return 0;const auto& e=*current().events[i];return e.ints.empty()||e.ints[0]!=0;}
EMSCRIPTEN_KEEPALIVE const float* sequence_event_position(int i){static glm::vec4 p;if(i<0||size_t(i)>=current().events.size())return nullptr;p=current().events[i]->Vector(0x5254CF6A,glm::vec4(0));return glm::value_ptr(p);}
EMSCRIPTEN_KEEPALIVE const char* sequence_error(){return error.c_str();}
EMSCRIPTEN_KEEPALIVE int sequence_actor_count(){return current().stream?current().stream->Actors().size():0;}
EMSCRIPTEN_KEEPALIVE int sequence_actor_kind(int i){return current().stream&&i>=0&&size_t(i)<current().stream->Actors().size()?int(current().stream->Actors()[i].kind):-1;}
EMSCRIPTEN_KEEPALIVE const char* sequence_actor_name(int i){return current().stream&&i>=0&&size_t(i)<current().stream->Actors().size()?current().stream->Actors()[i].target.c_str():"";}
EMSCRIPTEN_KEEPALIVE int sequence_actor_units(int i){return current().stream&&i>=0&&size_t(i)<current().stream->Actors().size()?current().stream->Actors()[i].units.size():0;}
EMSCRIPTEN_KEEPALIVE const float* sequence_sample(int actor,int unit,float frame){
 if(!current().stream||actor<0||size_t(actor)>=current().stream->Actors().size()||unit<0||size_t(unit)>=current().stream->Actors()[actor].units.size()||!std::isfinite(frame)||frame<0||frame>current().stream->Length())return nullptr;
 static float data[8];const auto& u=current().stream->Actors().at(actor).units.at(unit);glm::vec4 rotation(0,0,0,1),translation(0);bool ok=false;
 if(u.rotation>=0)ok|=current().tracks.at(u.rotation).Sample(frame,rotation);if(u.translation>=0)ok|=current().tracks.at(u.translation).Sample(frame,translation);if(!ok)return nullptr;
 for(int k=0;k<4;k++){data[k]=rotation[k];data[k+4]=translation[k];}return data;
}
EMSCRIPTEN_KEEPALIVE int sequence_event_count(){return current().events.size();}
EMSCRIPTEN_KEEPALIVE double sequence_event_start(int i){return current().events.at(i)->Start();}
EMSCRIPTEN_KEEPALIVE uint64_t sequence_event_type(int i){return current().events.at(i)->type;}
EMSCRIPTEN_KEEPALIVE uint64_t sequence_event_functor(int i){return current().events.at(i)->functor;}
EMSCRIPTEN_KEEPALIVE uint64_t sequence_event_string(int i,uint32_t key){return current().events.at(i)->String(key);}
EMSCRIPTEN_KEEPALIVE float sequence_event_float(int i,uint32_t key){return current().events.at(i)->Float(key);}
EMSCRIPTEN_KEEPALIVE float sequence_focal(float frame){if(!current().stream||!std::isfinite(frame)||frame<0||frame>current().stream->Length())return 0;const auto i=current().stream->FindActor(pt::anim::ActorKind::CameraParam);if(i<0)return 0;const auto& u=current().stream->Actors().at(i).units;if(u.empty()||u[0].tracks.empty())return 0;glm::vec4 v;return current().tracks.at(u[0].tracks[0]).Sample(frame,v)?v.x:0;}
EMSCRIPTEN_KEEPALIVE uint32_t sequence_event_sound(int i){if(i<0||size_t(i)>=current().events.size())return 0;const auto& e=*current().events[i];if(e.functor!=0x1CA12DC9F6C4ull&&e.functor!=0x436C48773668ull&&e.functor!=0xD0044B945DC2ull&&e.functor!=0x222ADA450A7Dull)return 0;const uint32_t id=e.Int(e.functor==0x222ADA450A7Dull?0xBD0B148A:0xE715467F,0);return id==0x811C9DC5u?0:id;}
}

#include "sequence_lights.h"
