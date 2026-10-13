using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;
using System.Text.Json;
using LibOrbisPkg.PKG;
using LibOrbisPkg.PFS;

namespace PT.PkgExtract;

// Diagnostic access includes system directories which the normal importer skips.
// Package names never become output paths. Extraction writes one fixed leaf.
public static class PackageAudit {
    public record Entry(string Path,long Bytes);
    static IEnumerable<PfsReader.File> Files(PfsReader.Dir dir) {
        foreach(var child in dir.children) {
            if(child is PfsReader.File file)yield return file;
            else if(child is PfsReader.Dir sub)foreach(var item in Files(sub))yield return item;
        }
    }
    static T Read<T>(string path,Func<string,List<PfsReader.File>,T> action) {
        using var stream=File.OpenRead(path);
        var magic=new byte[4];stream.ReadExactly(magic);stream.Position=0;
        if(!magic.SequenceEqual(new byte[]{0x7f,0x43,0x4e,0x54}))throw new IOException("Not a PS4 PKG.");
        var pkg=new PkgReader(stream).ReadPkg();
        var key=pkg.GetEkpfs()??throw new IOException(Extraction.RetailMessage);
        ulong offset=pkg.Header.pfs_image_offset,size=pkg.Header.pfs_image_size;
        if(offset>(ulong)stream.Length||size>(ulong)stream.Length-offset)throw new IOException("Truncated PFS image.");
        using var map=MemoryMappedFile.CreateFromFile(path,FileMode.Open,null,0,MemoryMappedFileAccess.Read);
        using var accessor=map.CreateViewAccessor((long)offset,(long)size,MemoryMappedFileAccess.Read);
        var outer=new PfsReader(accessor,pkg.Header.pfs_flags,key);
        using var image=outer.GetFile("pfs_image.dat").GetView();
        var inner=new PfsReader(new PFSCReader(image));
        return action(pkg.Header.content_id.TrimEnd('\0'),Files(inner.GetURoot()).ToList());
    }
    public static Entry[] Inventory(string package)=>Read(package,(_,files)=>files.Select(f=>new Entry(f.FullName,f.size)).OrderBy(f=>f.Path,StringComparer.Ordinal).ToArray());
    public static void Extract(string package,string entry,string destination) {
        if(Directory.Exists(destination))throw new IOException("Audit destination must not exist.");
        Read(package,(contentId,files)=>{
            var matches=files.Where(f=>f.FullName==entry).ToArray();
            if(matches.Length!=1)throw new IOException("Package entry must match exactly one file.");
            var file=matches[0];if(file.size<0||file.size>4L*1024*1024*1024)throw new IOException("Unexpected resource size.");
            Directory.CreateDirectory(destination);
            try {
                using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                using(var output=new FileStream(System.IO.Path.Combine(destination,"resource.bin"),FileMode.CreateNew,FileAccess.Write)) {
                    using var view=file.GetView();var buffer=new byte[1024*1024];
                    for(long pos=0;pos<file.size;){int count=(int)Math.Min(buffer.Length,file.size-pos);view.Read(pos,buffer,0,count);output.Write(buffer,0,count);hash.AppendData(buffer,0,count);pos+=count;}
                }
                File.WriteAllText(System.IO.Path.Combine(destination,"provenance.json"),JsonSerializer.Serialize(new {contentId,entry,bytes=file.size,sha256=Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()}));
            }catch {Directory.Delete(destination,true);throw;}
            return true;
        });
    }
}
