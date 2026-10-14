// Browser host for the upstream PlayerBody evaluator. Assets stay in the local archive.
#include <emscripten/emscripten.h>
#include "game/player_animation.h"
#include "engine/anim/help_bones.h"
#include <cmath>
#include <algorithm>
#include <memory>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>
namespace {
using namespace pt::game;
std::unique_ptr<PlayerBody> body;
float tick=0,idle=0,heading=0,body_yaw=0,rate=1;
bool standing=true,steered=false;
float output[12];
std::vector<glm::mat4> skin;
pt::anim::HelpBones help;
float wrap(float x){return std::atan2(std::sin(x),std::cos(x));}
const BodyClip& clip(int kind,int direction){auto& l=PlayerLocomotionData();return kind==1?l.starts.at(direction):kind==2?l.stops.at(direction):l.clips.at(direction);}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int locomotion_load(const uint8_t* rig,int rn,const uint8_t* skeleton,int sn,const uint8_t* motions,int mn){
 body.reset();if(rn<=0||sn<=0||mn<=0||rn>16*1024*1024||sn>32*1024*1024||mn>64*1024*1024)return 0;
 if(!LoadPlayerAnimationBytes({rig,size_t(rn)},{skeleton,size_t(sn)},std::vector<uint8_t>(motions,motions+mn)))return 0;
 body=std::make_unique<PlayerBody>();body->Reset(kClipStand);return 1;
}
EMSCRIPTEN_KEEPALIVE void locomotion_reset(float yaw){if(body)body->Reset(kClipStand);tick=idle=0;body_yaw=yaw;heading=yaw;standing=true;rate=1;steered=false;}
// Input is normalized camera-relative x/right, z/forward. Yaw is FOX +Z forward.
EMSCRIPTEN_KEEPALIVE const float* locomotion_step(float x,float z,float yaw,float dt){
 std::fill(std::begin(output),std::end(output),0);if(!body||!std::isfinite(x+z+yaw+dt)||dt<=0||dt>.02f)return output;
 const float magnitude=std::min(1.f,std::hypot(x,z));if(magnitude>=.1f)heading=wrap(yaw-std::atan2(x,z));
 tick+=dt;while(tick>=1.f/29.97003f){tick-=1.f/29.97003f;
  if(magnitude>=.1f){idle=0;standing=false;}else{idle+=1.f/29.97003f;if(idle>=.06673333f)standing=true;}
  const float delta=wrap(heading-body_yaw),a=std::abs(delta)/3.14159265f;
  const float mx=a<.5f?1.f+2*a*(.75f-1.f):.5f+2*(1-a)*(.75f-.5f);
  const float mn=a<.5f?.5f+2*a*(.4f-.5f):.25f+2*(1-a)*(.4f-.25f);
  rate=standing||magnitude<.1f?1.f:mn+std::clamp((magnitude-.1f)/.85f,0.f,1.f)*(mx-mn);steered=magnitude>=.1f;
  const int direction=WalkDirection(delta);auto kind=body->ClipKind();
  if(kind==PlayerBody::Kind::Start)body->Play(PlayerBody::Kind::Node,body->Clip());else if(kind==PlayerBody::Kind::Stop)body->Play(PlayerBody::Kind::Node,kClipStand);
  const bool stand=body->ClipKind()==PlayerBody::Kind::Node&&body->Clip()==kClipStand;
  if(standing){if(!stand)body->Play(PlayerBody::Kind::Stop,body->Clip());}
  else if(stand||body->ClipKind()==PlayerBody::Kind::Stop)body->Play(PlayerBody::Kind::Start,direction);
  else if(body->ClipKind()==PlayerBody::Kind::Node&&body->Clip()!=direction)body->Play(PlayerBody::Kind::Node,direction);
 }
 body_yaw=wrap(body_yaw+wrap(yaw-body_yaw)*(1-std::pow(1-1.f/12,dt*299.7003f*.2f)));
 auto advance=body->Advance(dt*59.94006f*rate,dt*59.94006f);
 float dx=std::cos(body_yaw)*advance.root.x+std::sin(body_yaw)*advance.root.y;
 float dz=-std::sin(body_yaw)*advance.root.x+std::cos(body_yaw)*advance.root.y;
 if(steered){dx=std::sin(heading)*advance.distance;dz=std::cos(heading)*advance.distance;}
 const auto head=body->Head();output[0]=dx;output[1]=dz;output[2]=advance.footsteps;output[3]=LastFootLeft(false);
 output[4]=head.x;output[5]=head.y+.06f;output[6]=head.z+.015f;output[7]=body_yaw;output[8]=body->Frame();output[9]=body->Clip();output[10]=int(body->ClipKind());output[11]=body->Blend();return output;
}
EMSCRIPTEN_KEEPALIVE int locomotion_help(const uint8_t* bytes,int size){std::string error;return size>0&&size<8*1024*1024&&help.Parse({bytes,size_t(size)},&error);}
EMSCRIPTEN_KEEPALIVE int locomotion_skin(float x,float y,float z){if(!body||!std::isfinite(x+y+z)||!body->Skin(&help,skin))return 0;const auto world=glm::translate(glm::mat4(1),glm::vec3(x,y,z))*glm::rotate(glm::mat4(1),body_yaw,glm::vec3(0,1,0));for(auto& m:skin)m=world*m;return skin.size();}
EMSCRIPTEN_KEEPALIVE const float* locomotion_skin_ptr(){return skin.empty()?nullptr:glm::value_ptr(skin[0]);}
EMSCRIPTEN_KEEPALIVE float locomotion_clip_frames(int kind,int direction){return clip(kind,direction).frames;}
EMSCRIPTEN_KEEPALIVE int locomotion_contacts(int kind,int direction){return clip(kind,direction).steps.size();}
EMSCRIPTEN_KEEPALIVE float locomotion_contact_frame(int kind,int direction,int i){return clip(kind,direction).steps.at(i).frame;}
EMSCRIPTEN_KEEPALIVE int locomotion_contact_left(int kind,int direction,int i){return clip(kind,direction).steps.at(i).left;}
}
