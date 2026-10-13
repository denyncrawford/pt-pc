// AudioWorklet-facing host of the native Wwise mixer. No game media is embedded.
#include <emscripten/emscripten.h>
#include "engine/audio/sound_engine.h"
#include "engine/audio/subtitles.h"
#include "engine/core/log.h"
#include "engine/core/text_encoding.h"
#include "engine/fs/mods.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <sstream>
#include <set>
namespace pt {void LogWrite(LogLevel,std::string_view s){printf("%.*s\n",int(s.size()),s.data());}}
namespace pt::os {std::string GetEnv(const char*){return {};}}
namespace pt::mods {const ModSet* Active(){return nullptr;} std::optional<std::vector<uint8_t>> ReadOverride(std::string_view){return std::nullopt;}}
namespace {
std::unique_ptr<pt::audio::SoundBankSet> banks;
std::unique_ptr<pt::audio::SoundEngine> engine;
pt::audio::SubtitleTable subtitles;
std::vector<std::vector<uint8_t>> sab;
std::vector<pt::audio::EngineNotification> notices;
std::string error;
float pcm[4096];
const pt::audio::SubtitleEntry* caption=nullptr;
struct Scheduled {uint64_t at;uint32_t event;};std::vector<Scheduled> scheduled;
std::map<std::string,std::shared_ptr<const pt::audio::Media>> streams;
struct Ambient {int object;pt::audio::PlayingId playing=0;float fade=0;};
std::map<std::string,Ambient> ambients;std::string ambient_target,ambient_volume="volumeRtpc";float ambient_rate=1000;
void updateAmbients(float dt){
 for(auto it=ambients.begin();it!=ambients.end();){auto& a=it->second;
  a.fade=std::clamp(a.fade+(it->first==ambient_target?dt:-dt)*ambient_rate,0.f,1.f);
  if(a.fade>0){if(!a.playing||!engine->IsPlaying(a.playing))a.playing=engine->PostEvent(pt::audio::Fnv1Hash32(it->first),a.object);
   engine->SetRtpc(pt::audio::Fnv1Hash32(ambient_volume),a.fade,a.object,false);}
  if(a.fade==0&&it->first!=ambient_target){engine->UnregisterObject(a.object);it=ambients.erase(it);}else ++it;
 }
}
size_t loaded=0;
std::map<int,pt::audio::PlayingId> sources;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void audio_reset(){engine.reset();ambients.clear();ambient_target.clear();sources.clear();streams.clear();banks=std::make_unique<pt::audio::SoundBankSet>();sab.clear();notices.clear();scheduled.clear();error.clear();loaded=0;caption=nullptr;}
EMSCRIPTEN_KEEPALIVE const char* audio_error(){return error.c_str();}
EMSCRIPTEN_KEEPALIVE int audio_load(const char* name,const uint8_t* bytes,int size,int package){
 if(!banks||size<=0||size>128*1024*1024||loaded+size>256*1024*1024){error="Audio package exceeds budget";return 0;}
 auto storage=std::make_shared<const std::vector<uint8_t>>(bytes,bytes+size);bool ok=true;
 if(!package)ok=banks->LoadBankBytes(name,storage,0,size,&error);
 else{std::vector<pt::audio::SbpEntry> entries;if(!pt::audio::ReadSbp(*storage,entries,&error))return 0;for(const auto& e:entries){if(e.kind=="bnk")ok&=banks->LoadBankBytes(name,storage,e.offset,e.size,&error);else if(e.kind=="sab")sab.emplace_back(bytes+e.offset,bytes+e.offset+e.size);}}
 if(ok)loaded+=size;return ok;
}
EMSCRIPTEN_KEEPALIVE int audio_stream_load(const char* name,const uint8_t* bytes,int size){
 if(size<=0||size>128*1024*1024)return 0;
 auto audio=pt::audio::ExtractDemoStreamAudio({bytes,size_t(size)});if(!audio)return 2;
 auto storage=std::make_shared<const std::vector<uint8_t>>(std::move(audio->wem));
 auto media=pt::audio::Media::Create(0,storage,0,storage->size(),&error);if(!media)return 0;
 streams[name]=std::move(media);return 1;
}
EMSCRIPTEN_KEEPALIVE int audio_stream_play(const char* name){
 auto it=streams.find(name);if(it==streams.end())return 0;
 if(!engine||!engine->HasEvent(pt::audio::kExternalSourceEvent)){error="Missing external source event";return 0;}
 return engine->PostEvent(pt::audio::kExternalSourceEvent,0,it->second);
}
EMSCRIPTEN_KEEPALIVE int audio_subtitles(const uint8_t* bytes,int size){if(size<=0||size>8*1024*1024)return 0;return subtitles.Parse({bytes,size_t(size)},sab,&error);}
EMSCRIPTEN_KEEPALIVE int audio_start(uint32_t seed){if(!banks)return 0;if(!banks->MediaErrors().empty()){error=banks->MediaErrors().front();return 0;}engine=std::make_unique<pt::audio::SoundEngine>(std::move(banks),seed);engine->RegisterObject(0,"global");engine->RegisterObject(1,"radio");engine->RegisterObject(2,"player");engine->SetMasterGain(1);return 1;}
EMSCRIPTEN_KEEPALIVE int audio_has_event(const char* name){return engine&&engine->HasEvent(pt::audio::Fnv1Hash32(name));}
// Each SoundSource owns its emitter; it must never move the radio's object.
EMSCRIPTEN_KEEPALIVE int audio_source(int index,const char* name,float x,float y,float z,float fx,float fy,float fz,int enabled,float fade){
 if(!engine||index<0||index>=256||!std::isfinite(x+y+z+fx+fy+fz))return 0;
 const int object=512+index;auto it=sources.find(index);
 if(!enabled){if(it!=sources.end()){engine->StopPlayingId(it->second,fade);sources.erase(it);}return 1;}
 auto event=pt::audio::Fnv1Hash32(name);if(!engine->HasEvent(event)){error="Missing source event: "+std::string(name);return 0;}
 engine->RegisterObject(object,name);engine->SetObjectTransform(object,{x,y,z},{fx,fy,fz});
 if(it==sources.end()||!engine->IsPlaying(it->second))sources[index]=engine->PostEvent(event,object);
 return sources[index];
}
EMSCRIPTEN_KEEPALIVE int audio_event_playing(const char* name){return engine&&engine->IsEventPlaying(pt::audio::Fnv1Hash32(name));}
EMSCRIPTEN_KEEPALIVE int audio_post(const char* name,float x,float y,float z,int spatial){if(!engine)return 0;auto id=pt::audio::Fnv1Hash32(name);if(!engine->HasEvent(id)){error="Missing audio event: "+std::string(name);return 0;}if(spatial)engine->SetObjectTransform(1,{x,y,z},{0,0,1});return engine->PostEvent(id,spatial?1:0);}
EMSCRIPTEN_KEEPALIVE int audio_effect_id(uint32_t event,int object,float x,float y,float z){
 if(!engine||object<16||object>255||!std::isfinite(x+y+z)||!engine->HasEvent(event))return 0;
 engine->RegisterObject(object,"gimmick motion");engine->SetObjectTransform(object,{x,y,z},{0,0,1});return engine->PostEvent(event,object);
}
EMSCRIPTEN_KEEPALIVE int audio_effect(const char* name,int object,float x,float y,float z){
 if(!engine||object<16||object>255||!std::isfinite(x+y+z))return 0;const auto id=pt::audio::Fnv1Hash32(name);if(!engine->HasEvent(id))return 0;
 engine->RegisterObject(object,"demo effect");engine->SetObjectTransform(object,{x,y,z},{0,0,1});return engine->PostEvent(id,object);
}
EMSCRIPTEN_KEEPALIVE int audio_ambience(const char* event,const char* volume,const char* rtpc,float value,float rate){
 if(!engine||!std::isfinite(value)||!std::isfinite(rate)||rate<=0)return 0;
 if(*event&&!engine->HasEvent(pt::audio::Fnv1Hash32(event)))return 0;
 if(*event&&!ambients.contains(event)){
  if(ambients.size()>=16)return 0;int object=768;for(;;object++){bool used=false;for(auto& [_,a]:ambients)used|=a.object==object;if(!used)break;}
  engine->RegisterObject(object,"Ambient");ambients.emplace(event,Ambient{object});
 }
 ambient_target=event;ambient_volume=volume;ambient_rate=rate;
 if(*rtpc)engine->SetRtpc(pt::audio::Fnv1Hash32(rtpc),value,0,false);return 1;
}
EMSCRIPTEN_KEEPALIVE int audio_ambient_count(){return ambients.size();}
EMSCRIPTEN_KEEPALIVE int audio_effect_alive(int playing){return engine&&engine->IsPlaying(playing);}
EMSCRIPTEN_KEEPALIVE void audio_effect_transform(int object,float x,float y,float z,float fx,float fy,float fz){if(engine&&object>=16&&object<=255)engine->SetObjectTransform(object,{x,y,z},{fx,fy,fz});}
EMSCRIPTEN_KEEPALIVE void audio_effect_release(int playing,int object,float fade,int curve,int stop){
 if(!engine||object<16||object>255)return;if(stop&&playing>0)engine->StopPlayingId(playing,std::clamp(fade,0.f,30.f),pt::audio::Interp(std::clamp(curve,0,9)));
}
EMSCRIPTEN_KEEPALIVE int audio_effect_collect(int playing,int object){if(!engine||object<16||object>255)return 0;if(engine->IsPlaying(playing))return 0;engine->UnregisterObject(object);return 1;}
EMSCRIPTEN_KEEPALIVE void audio_acoustic(int object,float obstruction,float occlusion){if(engine)engine->SetObjectObstruction(object,obstruction,occlusion);}
EMSCRIPTEN_KEEPALIVE void audio_sends_clear(int object){if(engine)engine->SetObjectAuxSends(object,{});}
// One complete bounded send list per command avoids stale sends on zone exit.
EMSCRIPTEN_KEEPALIVE void audio_sends(int object,const uint32_t* ids,const float* levels,int count){if(!engine||count<0||count>16)return;std::vector<std::pair<uint32_t,float>> sends;for(int i=0;i<count;i++)if(std::isfinite(levels[i]))sends.push_back({ids[i],levels[i]});engine->SetObjectAuxSends(object,std::move(sends));}
EMSCRIPTEN_KEEPALIVE uint32_t audio_hash(const char* name){return pt::audio::Fnv1Hash32(name);}
EMSCRIPTEN_KEEPALIVE int audio_footstep(int left,uint32_t surface,float x,float y,float z){
 if(!engine)return 0;uint32_t material=0x7AAB588A;
 switch(surface){case 0x59D11AF1:material=0x9D366849;break;case 0x5F263606:material=0xDDC5A09E;break;case 0x2D2AEFA4:material=0xEA8341EB;break;case 0x4FB17187:material=0xA5BE6B99;break;}
 engine->SetObjectTransform(2,{x,y,z},{0,0,1});engine->SetSwitch(0xE6640542,material,2);
 return engine->PostEvent(pt::audio::Fnv1Hash32(left?"Play_plr_footstep_wk_l":"Play_plr_footstep_wk_r"),2);
}
EMSCRIPTEN_KEEPALIVE int audio_schedule(uint32_t id,double seconds){if(!engine||!engine->HasEvent(id)||!std::isfinite(seconds)||seconds<0||seconds>3600||scheduled.size()>=128)return 0;scheduled.push_back({engine->RenderedFrames()+uint64_t(std::llround(seconds*48000)),id});std::stable_sort(scheduled.begin(),scheduled.end(),[](auto a,auto b){return a.at<b.at;});return 1;}
EMSCRIPTEN_KEEPALIVE void audio_listener(float x,float y,float z,float fx,float fy,float fz){if(engine&&std::isfinite(x+y+z+fx+fy+fz))engine->SetListener({x,y,z},{fx,fy,fz},{0,1,0});}
EMSCRIPTEN_KEEPALIVE const float* audio_render(int frames){if(!engine||frames<1||frames>2048)return nullptr;updateAmbients(frames/48000.f);int done=0;while(done<frames){const auto now=engine->RenderedFrames();while(!scheduled.empty()&&scheduled.front().at<=now){engine->PostEvent(scheduled.front().event,0);scheduled.erase(scheduled.begin());}int n=frames-done;if(!scheduled.empty())n=std::min<uint64_t>(n,scheduled.front().at-now);engine->Render(pcm+done*2,n);done+=n;}return pcm;}
EMSCRIPTEN_KEEPALIVE double audio_time(){return engine?engine->RenderedFrames()/48000.0:0;}
EMSCRIPTEN_KEEPALIVE int audio_notifications(){if(!engine)return 0;notices=engine->TakeNotifications();return notices.size();}
EMSCRIPTEN_KEEPALIVE const char* audio_marker(int i){return i>=0&&size_t(i)<notices.size()?notices[i].label.c_str():"";}
EMSCRIPTEN_KEEPALIVE int audio_notice_kind(int i){return i>=0&&size_t(i)<notices.size()?int(notices[i].kind):-1;}
EMSCRIPTEN_KEEPALIVE int audio_notice_playing(int i){return i>=0&&size_t(i)<notices.size()?notices[i].playing_id:0;}
EMSCRIPTEN_KEEPALIVE int audio_caption(const char* marker){caption=subtitles.FindByMarker(marker);return caption?caption->lines.size():0;}
EMSCRIPTEN_KEEPALIVE const char* audio_caption_id(){return caption?caption->id.c_str():"";}
EMSCRIPTEN_KEEPALIVE const char* audio_caption_text(int i){static std::string text;text.clear();if(caption&&i>=0&&size_t(i)<caption->lines.size()){const auto& raw=caption->lines[i].text;text=pt::text::ValidUtf8(raw)?raw:pt::text::Cp1252ToUtf8(raw);}return text.c_str();}
EMSCRIPTEN_KEEPALIVE double audio_caption_start(int i){return caption&&i>=0&&size_t(i)<caption->lines.size()?caption->lines[i].start_seconds:0;}
EMSCRIPTEN_KEEPALIVE double audio_caption_end(int i){return caption&&i>=0&&size_t(i)<caption->lines.size()?caption->lines[i].end_seconds:0;}
EMSCRIPTEN_KEEPALIVE void audio_stop(){if(engine)engine->StopAll(0);scheduled.clear();}
}

extern "C" EMSCRIPTEN_KEEPALIVE const char* audio_event_sources(const char* name){
 static std::string result;std::ostringstream out;out<<"[";bool first=true;std::set<uint32_t> visited;
 const auto* set=engine?&engine->Banks():banks.get();if(!set)return "[]";
 std::vector<uint32_t> pending={pt::audio::Fnv1Hash32(name)};
 while(!pending.empty()){auto id=pending.back();pending.pop_back();if(!visited.insert(id).second)continue;auto* o=set->Find(id);if(!o)continue;
 if(auto* e=dynamic_cast<const pt::audio::EventObject*>(o))pending.insert(pending.end(),e->action_ids.begin(),e->action_ids.end());
 else if(auto* a=dynamic_cast<const pt::audio::ActionObject*>(o))pending.push_back(a->target_id);
 else if(auto* r=dynamic_cast<const pt::audio::RanSeqObject*>(o))pending.insert(pending.end(),r->children.begin(),r->children.end());
 else if(auto* sw=dynamic_cast<const pt::audio::SwitchObject*>(o))pending.insert(pending.end(),sw->children.begin(),sw->children.end());
 else if(auto* sound=dynamic_cast<const pt::audio::SoundObject*>(o)){auto media=set->FindMedia(sound->source.source_id);double energy=0;if(media){auto reader=media->OpenReader();std::vector<float> samples(256*media->Channels());for(int block=0;block<188;block++){auto frames=reader->Read(samples.data(),256);for(size_t i=0;i<frames*media->Channels();i++)energy+=double(samples[i])*samples[i];if(!frames)break;}}if(!first)out<<",";first=false;out<<"{\"node\":"<<id<<",\"plugin\":"<<sound->source.plugin_id<<",\"source\":"<<sound->source.source_id<<",\"file\":"<<sound->source.file_id<<",\"mediaPresent\":"<<(media?"true":"false")<<",\"firstSecondEnergy\":"<<energy<<"}";}
 }out<<"]";result=out.str();return result.c_str();
}
