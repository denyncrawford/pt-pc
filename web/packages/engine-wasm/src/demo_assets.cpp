// Read original DemoData mappings and effect nodes through the native parsers.
#include <emscripten/emscripten.h>
#include "engine/data/fox2.h"
#include "engine/vfx/vfx_file.h"
#include "engine/core/strcode.h"
#include "engine/core/pathcode.h"
#include "engine/anim/gani.h"
#include <sstream>
#include <iomanip>
extern "C" {
EMSCRIPTEN_KEEPALIVE const char* model_parts_json(const uint8_t* bytes,int size){
 static std::string result;pt::fox2::DataSetFile f;
 if(size<=0||!f.Load("model.parts",{bytes,size_t(size)}))return nullptr;
 for(const auto& e:f.Entities())if(e.class_name=="ModelDescription"){
 std::ostringstream out;out<<"{\"modelFile\":"<<std::quoted(f.GetString(e,"modelFile"))<<",\"hidden\":[";
 const auto* p=f.FindProperty(e,"invisibleMeshNames");
 for(size_t i=0;p&&i<p->Count();i++){if(i)out<<",";out<<std::quoted(f.ElementString(*p,i));}
 out<<"]}";result=out.str();return result.c_str();}return nullptr;
}

EMSCRIPTEN_KEEPALIVE const char* demo_assets_json(const uint8_t* bytes,int size){
 static std::string result;pt::fox2::DataSetFile f;
 if(size<=0||size>32*1024*1024||!f.Load("demo",{bytes,size_t(size)}))return nullptr;
 std::ostringstream out;out<<"[";bool first=true;
 for(const auto& e:f.Entities())if(e.class_name=="DemoData"){
  if(!first)out<<",";first=false;out<<"{\"id\":"<<std::quoted(f.GetString(e,"demoId"));
  for(const auto prop:{"demoStreamPath","motionPath","audioPath"})out<<","<<std::quoted(prop)<<":"<<std::quoted(f.GetString(e,prop));
  for(const auto prop:{"cameraInterpType","cameraInterpFrame"})out<<","<<std::quoted(prop)<<":"<<f.GetInt(e,prop);
  out<<",\"cameraInterpCurveRate\":"<<f.GetFloat(e,"cameraInterpCurveRate",0,1.0f)<<",\"cameraInterpScurveCenter\":"<<f.GetFloat(e,"cameraInterpScurveCenter",0,.5f);
  const auto* animation=f.GetEntity(e,"streamAnimation");
  for(const auto prop:{"fileParams","modelFiles","partsFiles","modelPartsDictionary"}){
   out<<","<<std::quoted(prop)<<":{";const auto* owner=std::string(prop)=="fileParams"?&e:animation;bool fp=true;
   if(owner)if(const auto* p=f.FindProperty(*owner,prop))for(size_t i=0;i<p->Count();i++){if(!fp)out<<",";fp=false;out<<std::quoted(f.KeyString(*p,i))<<":"<<std::quoted(f.ElementString(*p,i));}
   out<<"}";
  }out<<"}";
 }out<<"]";result=out.str();return result.c_str();
}
EMSCRIPTEN_KEEPALIVE const char* effect_nodes_json(const uint8_t* bytes,int size){
 static std::string result;pt::vfx::File f;if(size<=0||size>32*1024*1024||!pt::vfx::ParseFile({bytes,size_t(size)},f))return nullptr;
 std::ostringstream out;out<<"{\"nodes\":[";bool first=true;for(const auto& n:f.nodes){if(!first)out<<",";first=false;out<<std::quoted(n.ClassName());}
 pt::vfx::SoundNode sound;const bool ok=pt::vfx::ReadSoundNode({bytes,size_t(size)},sound);
 out<<"],\"sound\":";if(ok)out<<"{\"play\":"<<std::quoted(sound.play)<<",\"stop\":"<<std::quoted(sound.stop)<<",\"stopPlaying\":"<<(sound.stop_playing?"true":"false")<<",\"fade\":"<<sound.fade<<",\"curve\":"<<sound.curve<<"}";else out<<"null";
 out<<"}";result=out.str();return result.c_str();
}
// Inspect a native gimmick clip's sound cues; frame numbers remain in its own timebase.
EMSCRIPTEN_KEEPALIVE const char* gimmick_audio_json(const uint8_t* bytes,int size,const char* path){
 static std::string result;pt::anim::MotionArchive archive;std::string error;
 if(size<=0||size>128*1024*1024||!archive.Parse({bytes,bytes+size},&error))return nullptr;
 auto m=archive.Find(pt::PathCode64(path));if(!m)return nullptr;std::ostringstream out;
 out<<"{\"frames\":"<<m->frames<<",\"fps\":"<<std::setprecision(17)<<299.7003/(m->ticks_per_frame?m->ticks_per_frame:5)<<",\"loop\":"<<(m->Loops()?"true":"false")<<",\"events\":[";bool first=true;
 for(const auto& ge:m->events)for(const auto& section:ge.event.sections){const auto& e=ge.event;if(!first)out<<",";first=false;
  out<<"{\"frame\":"<<section.start<<",\"type\":"<<e.type<<",\"bone\":"<<std::quoted(std::to_string(e.StringArg(0)))<<",\"args\":[";bool a=true;for(auto i:e.ints){if(!a)out<<",";a=false;out<<i;}out<<"]}";
 }out<<"]}";result=out.str();return result.c_str();
}
EMSCRIPTEN_KEEPALIVE uint64_t demo_name_code(const char* name){return pt::StrCode64(name)&pt::kStrCode64Mask;}
}
