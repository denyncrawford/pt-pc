// Browser bridge to the original VFX compiler and simulator. No replacement particles.
#include <emscripten/emscripten.h>
#include <glm/gtc/type_ptr.hpp>
#include "engine/vfx/vfx_system.h"
#include <sstream>
#include <iomanip>
#include <map>
#include <algorithm>
#include <cmath>
namespace {
pt::vfx::System effects;
std::map<std::string,std::vector<uint8_t>> files;
pt::vfx::RenderList render;
std::vector<pt::vfx::LightOut> lights;
std::vector<std::string> textures;
std::map<uint64_t,std::shared_ptr<pt::vfx::ModelMesh>> models;
pt::vfx::ViewInfo view;
uint32_t texture(const std::string& path){if(path.empty())return pt::vfx::kNoTexture;auto it=std::find(textures.begin(),textures.end(),path);if(it==textures.end()){textures.push_back(path);return textures.size()-1;}return it-textures.begin();}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void vfx_reset(){effects.Clear();effects.ClearCache();files.clear();models.clear();textures.clear();render.Clear();lights.clear();view={};effects.SetModelReader([](uint64_t code)->std::shared_ptr<const pt::vfx::ModelMesh>{auto it=models.find(code);return it==models.end()?nullptr:it->second;});effects.SetReader([](const std::string& path)->std::optional<std::vector<uint8_t>>{auto it=files.find(path);if(it==files.end())return std::nullopt;return it->second;});}
EMSCRIPTEN_KEEPALIVE int vfx_file(const char* path,const uint8_t* data,int size){if(!path||size<=0||size>32*1024*1024)return 0;files[path]={data,data+size};return 1;}
EMSCRIPTEN_KEEPALIVE const char* vfx_manifest(const char* path){
 static std::string result;auto it=files.find(path);if(it==files.end())return nullptr;pt::vfx::File parsed;if(!pt::vfx::ParseFile(it->second,parsed))return nullptr;auto d=pt::vfx::CompileEffect(parsed,path);if(!d)return nullptr;std::ostringstream out;
 out<<"{\"frames\":"<<d->all_frame<<",\"playMode\":"<<d->play_mode<<",\"shapes\":[";bool first=true;
 for(const auto& s:d->shapes){if(!first)out<<",";first=false;const auto& m=s.material;
  out<<"{\"kind\":"<<int(s.kind)<<",\"material\":"<<int(m.kind)<<",\"blend\":"<<int(m.blend)<<",\"texture\":"<<std::quoted(m.texture)<<",\"normal\":"<<std::quoted(m.normal)<<",\"reflection\":"<<std::quoted(m.reflection_texture)<<",\"rain\":"<<std::quoted(m.rain_texture)<<",\"model\":"<<std::quoted(std::to_string(s.model))<<",\"infinite\":"<<(s.life.infinite?"true":"false")<<"}";
 }
 out<<"],\"flares\":[";first=true;for(const auto& f:d->flares){if(!first)out<<",";first=false;out<<std::quoted(f.lens_flare);}
 out<<"],\"unsupported\":[";first=true;for(const auto& u:d->unsupported){if(!first)out<<",";first=false;out<<std::quoted(u);}out<<"]}";result=out.str();return result.c_str();
}
EMSCRIPTEN_KEEPALIVE int vfx_model(const char* code,const float* vertices,const float* uv,const uint32_t* indices,int nv,int ni){
 if(!code||!vertices||!uv||!indices||nv<=0||nv>1000000||ni<=0||ni>3000000)return 0;
 auto mesh=std::make_shared<pt::vfx::ModelMesh>();for(int i=0;i<nv;i++){mesh->positions.push_back(glm::make_vec3(vertices+i*6));mesh->uvs.push_back(glm::make_vec2(uv+i*2));}
 for(int i=0;i<ni;i++){if(indices[i]>=uint32_t(nv))return 0;mesh->indices.push_back(indices[i]);}models[std::strtoull(code,nullptr,10)]=mesh;return 1;
}
EMSCRIPTEN_KEEPALIVE int vfx_spawn(int id,const char* path,const float* world,uint32_t seed){if(id<0||!world)return 0;return effects.Spawn({1,uint64_t(id)},path,glm::make_mat4(world),seed);}
EMSCRIPTEN_KEEPALIVE void vfx_remove(int id){effects.Remove({1,uint64_t(id)});}
EMSCRIPTEN_KEEPALIVE void vfx_stop(int id){effects.Stop({1,uint64_t(id)});}
EMSCRIPTEN_KEEPALIVE int vfx_instances(){return effects.InstanceCount();}
EMSCRIPTEN_KEEPALIVE int vfx_particles(){return effects.ParticleCount();}
// View: position, forward, up, right, matrix (16), aspect, fovY, near.
EMSCRIPTEN_KEEPALIVE int vfx_tick(float dt,const float* values){
 if(!values||!std::isfinite(dt)||dt<0||dt>.25f)return 0;for(int i=0;i<31;i++)if(!std::isfinite(values[i]))return 0;
 view.position=glm::make_vec3(values);view.forward=glm::make_vec3(values+3);view.up=glm::make_vec3(values+6);view.right=glm::make_vec3(values+9);view.view_projection=glm::make_mat4(values+12);view.aspect=values[28];view.fov_y=values[29];view.near_plane=values[30];
 if(view.aspect<=0||view.fov_y<=0||view.near_plane<=0)return 0;
 effects.Update(dt,view);render.Clear();lights.clear();effects.Build(view,texture,texture,{},render,lights);return 1;
}
EMSCRIPTEN_KEEPALIVE int vfx_quad_count(){return render.quads.size();}
EMSCRIPTEN_KEEPALIVE const void* vfx_quad_data(){return render.quads.data();}
EMSCRIPTEN_KEEPALIVE int vfx_draw_count(){return render.draws.size();}
EMSCRIPTEN_KEEPALIVE int vfx_light_count(){return lights.size();}
EMSCRIPTEN_KEEPALIVE int vfx_texture_count(){return textures.size();}
EMSCRIPTEN_KEEPALIVE const char* vfx_texture_path(int i){return i>=0&&size_t(i)<textures.size()?textures[i].c_str():"";}
}
