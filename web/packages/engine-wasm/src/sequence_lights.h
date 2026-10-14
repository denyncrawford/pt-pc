// Portable subset of DemoSystem::RunFunctor/SampleActors used by the hallway demos.
#include "engine/render/scene_lighting.h"
#include <glm/gtc/quaternion.hpp>
#include <sstream>
#include <iomanip>
struct BrowserDemoLight {
 uint64_t code=0,locator=0,constraint=0; glm::vec3 offset{0}; bool point=false,enabled=true,shadow=true; float end=-1;
 glm::vec4 color{.1f,.5f,.1f,1},rotation{0,0,0,1}; glm::vec3 translation{0};
 float shadowUmbra=45,shadowPenumbra=45,bias=0,viewBias=0;
 float temperature=6500,lumen=1,deflection=0,power=1,attenuation=1.2f,umbra=45,penumbra=30,inner=.05f,outer=5;
};
static int LightOperation(uint64_t f,bool& point){
 if(f==0x73dd1c798d85ull)return 10;
 const char* ops[]={"CreateLight","SetColor","SetWorldMatrix","SetEnable","SetShadow","SetRange","SetShadowAngularAttenuation","SetViewBias","SetBias","SetAngle"};
 for(int cls=0;cls<2;cls++)for(int i=0;i<10;i++)if(f==(pt::StrCode64(std::string(cls?"DemoPointLightFunctor_":"DemoLightFunctor_")+ops[i])&pt::kStrCode64Mask)){point=cls;return i;}
 return -1;
}
static std::vector<BrowserDemoLight> demoLights;
static std::vector<std::array<float,28>> demoLightData;
static float LightFloat(const pt::anim::StreamEvent& e,uint32_t key,float fallback,float t){auto p=e.Param(key);const float a=e.Float(key,fallback);return p&&p->interpolated?a+(e.Float(key,fallback,true)-a)*t:a;}
static glm::vec4 LightVector(const pt::anim::StreamEvent& e,uint32_t key,glm::vec4 fallback,float t){auto p=e.Param(key);auto a=e.Vector(key,fallback);if(!p||!p->interpolated)return a;auto b=e.Vector(key,fallback,true);return p->type==pt::anim::ParamType::Quat?pt::anim::SlerpKey(a,b,t):glm::mix(a,b,t);}
extern "C" {
EMSCRIPTEN_KEEPALIVE int sequence_light_event(int i){bool point=false;return LightOperation(current().events.at(i)->functor,point)>=0;}
EMSCRIPTEN_KEEPALIVE int sequence_lights(float frame,const float* origin){
 demoLights.clear();demoLightData.clear();auto& s=current();
 for(auto ep:s.events){const auto& e=*ep;if(e.Start()>frame)continue;bool point=false;int op=LightOperation(e.functor,point);if(op<0)continue;
 const auto code=e.String(0x0C8D2F3D);auto it=std::find_if(demoLights.begin(),demoLights.end(),[&](auto& l){return l.code==code;});
 if(it==demoLights.end()){demoLights.push_back({});it=demoLights.end()-1;it->code=code;it->point=point;}auto& l=*it;
 const float t=e.End()>e.Start()?std::clamp((frame-e.Start())/float(e.End()-e.Start()),0.f,1.f):1;
 auto f=[&](uint32_t k,float v){return LightFloat(e,k,v,t);};
 if(op==0){l.locator=e.String(0xEC624270);l.end=e.End()>e.Start()?e.End():-1;}
 else if(op==1){l.color=LightVector(e,0x78F4ACF2,l.color,t);l.temperature=f(0x8AE71C43,l.temperature);l.lumen=f(0x65291325,l.lumen);l.deflection=f(0xF16480C5,l.deflection);l.power=f(0x081E11B9,l.power);l.attenuation=f(0x706196B3,l.attenuation);l.penumbra=f(0x0264EA9F,l.penumbra);l.umbra=f(0x712B61BD,l.umbra);}
 else if(op==2){l.rotation=LightVector(e,0x4BAA6AFC,l.rotation,t);l.translation=glm::vec3(LightVector(e,0x7B47D88A,glm::vec4(l.translation,1),t));}
 else if(op==3)l.enabled=e.Bool(0x1CEC027A,l.enabled);
 else if(op==4)l.shadow=e.Bool(0x9EC6ED71,l.shadow);
 else if(op==5){l.inner=f(0x24EDC727,l.inner);l.outer=f(0xB866793C,l.outer);}
 else if(op==6){l.shadowPenumbra=f(0x2A383233,l.shadowPenumbra);l.shadowUmbra=f(0xB3878239,l.shadowUmbra);}
 else if(op==7)l.viewBias=f(0x26C9C23D,l.viewBias);
 else if(op==8)l.bias=f(0x5BD7EC42,l.bias);
 else if(op==10){l.constraint=e.String(0x37171C7E);l.offset=glm::vec3(e.Vector(0x7EBB25E1));}
 else if(op==9){l.penumbra=f(0x0264EA9F,l.penumbra);l.umbra=f(0x712B61BD,l.umbra);}
 }
 const auto base=origin?glm::make_mat4(origin):glm::mat4(1);
 for(auto& l:demoLights){auto m=base*glm::translate(glm::mat4(1),l.translation)*glm::mat4_cast(glm::quat(l.rotation.w,l.rotation.x,l.rotation.y,l.rotation.z));
  for(const auto& a:s.stream->Actors())if(a.kind==pt::anim::ActorKind::Locator&&(pt::StrCode64(a.target)&pt::kStrCode64Mask)==(l.constraint?l.constraint:l.locator)&&!a.units.empty()){
   glm::vec4 q(0,0,0,1),p(0);const auto& u=a.units[0];if(u.rotation>=0)s.tracks[u.rotation].Sample(frame,q);if(u.translation>=0)s.tracks[u.translation].Sample(frame,p);
   m=base*glm::translate(glm::mat4(1),glm::vec3(p))*glm::mat4_cast(glm::quat(q.w,q.x,q.y,q.z))*glm::translate(glm::mat4(1),l.offset);break;
  }
  std::array<float,28> d{};auto rgb=pt::light_math::ColorFromTemperature(l.temperature,l.deflection,l.lumen,glm::vec3(l.color));const float pi=glm::pi<float>();
  rgb*=l.point?1.f/(4*pi*pi):l.power/(pt::light_math::SpotSolidAngle(l.umbra,l.penumbra,l.attenuation)*pi);
  const auto direction=glm::normalize(glm::mat3(m)*glm::vec3(0,-1,0));for(int k=0;k<3;k++){d[k]=m[3][k];d[4+k]=rgb[k];d[8+k]=direction[k];}
  d[3]=l.outer;d[7]=0;d[11]=l.point?-1:cos(glm::radians(l.umbra*.5f));d[12]=l.point?-1:cos(glm::radians(l.penumbra*.5f));d[13]=l.attenuation;d[14]=l.inner;d[15]=l.shadow;d[16]=(l.enabled&&(l.end<0||frame<l.end))?1:0;d[17]=1;d[18]=l.lumen;d[20]=l.bias*.001f;d[21]=l.point?0:l.viewBias*.001f;d[22]=1;d[23]=l.point?-1:cos(glm::radians(l.shadowUmbra*.5f));d[24]=1/std::max(float(cos(glm::radians(l.shadowPenumbra*.5f)))-d[23],.00001f);demoLightData.push_back(d);
 }return demoLights.size();
}
EMSCRIPTEN_KEEPALIVE uint64_t sequence_light_name(int i){return demoLights.at(i).code;}
EMSCRIPTEN_KEEPALIVE const float* sequence_light_data(int i){return demoLightData.at(i).data();}
EMSCRIPTEN_KEEPALIVE const char* sequence_event_diagnostic(int i){static std::string result;const auto& e=*current().events.at(i);std::ostringstream o;o<<"{";bool first=true;for(const auto& p:e.params){if(!first)o<<",";first=false;o<<std::quoted(std::to_string(p.key))<<":";if(p.type==pt::anim::ParamType::String)o<<std::quoted(std::to_string(e.String(p.key)));else o<<e.Float(p.key);}o<<"}";result=o.str();return result.c_str();}
}
