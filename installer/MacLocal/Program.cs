// SPDX-License-Identifier: LGPL-3.0-or-later
// Local macOS frontend for the project's existing extraction helper.
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PT.PkgExtract;

namespace PT.MacLocal;

public static class Program {
    public static async Task<int> Main(string[] args) {
        try {
            if (args.Length == 2 && args[0] == "--list") { Console.WriteLine(JsonSerializer.Serialize(PackageAudit.Inventory(args[1]))); return 0; }
            if (args.Length == 4 && args[0] == "--extract-file") { PackageAudit.Extract(args[1],args[2],args[3]); return 0; }
            if (args.Length == 2 && args[0] == "--serve") { await Serve(args[1]); return 0; }
            if (args.Length == 1 && args[0] == "--help") {
                Console.WriteLine("PT.MacExtract <archivo.pkg> <carpeta-nueva>\nPT.MacExtract --list <archivo.pkg>\nPT.MacExtract --extract-file <archivo.pkg> <entrada-exacta> <carpeta-nueva>\nSin argumentos: extracción interactiva.\nPT.MacExtract --serve <carpeta-del-visor>");
                return 0;
            }
            if (args.Length != 0 && args.Length != 2) throw new ArgumentException("Usa PT.MacExtract <archivo.pkg> <carpeta-nueva>, o ejecútalo sin argumentos.");
            string package, destination;
            if (args.Length == 0) {
                Console.WriteLine("Extractor local de P.T. para Mac\nLee fPKG; escribe únicamente los archivos que necesita el port.\n");
                Console.Write("Arrastra el PKG a esta ventana y pulsa Intro (o pega su ruta): ");
                package = ParsePath(Console.ReadLine() ?? "");
                destination = Path.Combine(Environment.CurrentDirectory, "extraidos", "PT-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..6]);
            } else { package = args[0]; destination = args[1]; }
            Extract(package, destination);
            return 0;
        } catch (Exception e) {
            Console.Error.WriteLine("\nNo se completó la operación: " + Explain(e));
            return 1;
        }
    }

    // Finder drops shell-escaped paths into Terminal. Parse quoting, never execute it.
    public static string ParsePath(string raw) {
        raw = raw.Trim();
        if (raw.Length == 0) throw new ArgumentException("No se indicó un archivo.");
        if (File.Exists(raw)) return Path.GetFullPath(raw);
        var b = new StringBuilder(); char quote = '\0';
        for (int i = 0; i < raw.Length; i++) {
            char c = raw[i];
            if (c == '\\' && quote != '\'' && i + 1 < raw.Length) { b.Append(raw[++i]); continue; }
            if (c == '\'' || c == '"') {
                if (quote == '\0') { quote = c; continue; }
                if (quote == c) { quote = '\0'; continue; }
            }
            b.Append(c);
        }
        if (quote != '\0') throw new ArgumentException("La ruta tiene una comilla sin cerrar.");
        var result = b.ToString();
        if (result.StartsWith("~/")) result = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), result[2..]);
        return Path.GetFullPath(result);
    }

    public static string Explain(Exception e) {
        if (e.Message == Extraction.RetailMessage) return "El PKG es de PlayStation Store o está dañado. Este extractor abre fPKG creados desde un dump; para el PKG de Store se necesita primero una copia extraída desde la consola.";
        if (e.Message == Extraction.NotPtMessage) return "No se encontraron los archivos de P.T. en este paquete. Comprueba que sea el juego base y no una actualización.";
        if (e is EndOfStreamException) return "El archivo está truncado o incompleto.";
        if (e is UnauthorizedAccessException) return "No hay acceso al archivo o a la carpeta de destino. Elige una carpeta donde puedas escribir.";
        return e.Message;
    }

    public static void Extract(string package, string destination) {
        package = Path.GetFullPath(package); destination = Path.GetFullPath(destination);
        if (!File.Exists(package)) throw new FileNotFoundException("No existe el PKG: " + package);
        if (Directory.Exists(destination) || File.Exists(destination)) throw new IOException("El destino ya existe. Elige una carpeta nueva; no se sobrescribe ningún archivo.");
        string parent = Path.GetDirectoryName(destination)!;
        Directory.CreateDirectory(parent);
        string stage = Path.Combine(parent, ".pt-extract-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage);
        Console.WriteLine("\nOrigen: " + package + "\nDestino: " + destination);
        Console.WriteLine("Leyendo el índice del paquete…");
        try {
            var warnings = Extraction.Run(package, stage, message => Console.WriteLine(message.Replace("Extracting ", "Extrayendo ").Replace("warning: ", "Aviso: ")));
            var manifest = new List<object>();
            foreach (string name in Extraction.Required) {
                string path = Path.Combine(stage, name);
                if (!File.Exists(path)) continue;
                Console.WriteLine("Verificando SHA-256: " + name);
                using var file = File.OpenRead(path);
                manifest.Add(new { name, bytes = file.Length, sha256 = Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant() });
            }
            File.WriteAllText(Path.Combine(stage, "manifest.json"), JsonSerializer.Serialize(new {
                tool = "PT.MacExtract", extractedAtUtc = DateTime.UtcNow, files = manifest, warnings
            }, new JsonSerializerOptions { WriteIndented = true }));
            Directory.Move(stage, destination);
        } catch {
            // Only remove this invocation's private staging directory.
            try { if (Directory.Exists(stage)) Directory.Delete(stage, true); } catch { Console.Error.WriteLine("Quedaron archivos parciales en: " + stage); }
            throw;
        }
        Console.WriteLine("\nExtracción completada.\n" + destination);
        Console.WriteLine("\nAbre «2 - Probar visor.command». En el visor pulsa «Abrir chunk1.psarc / FPK / FMDL»\ny selecciona este archivo:\n" + Path.Combine(destination, "chunk1.psarc"));
        Console.WriteLine("El visor actual muestra modelos individuales; el montaje FOX2 y las texturas originales siguen pendientes.");
    }

    // Serve only the fixed viewer files, never extracted game assets or arbitrary paths.
    public static async Task Serve(string root) {
        root = Path.GetFullPath(root);
        var types = new Dictionary<string, string> {
            ["index.html"] = "text/html; charset=utf-8", ["app.js"] = "text/javascript; charset=utf-8",
            ["archives.js"] = "text/javascript; charset=utf-8", ["geometry.js"] = "text/javascript; charset=utf-8",
            ["geometry.wasm"] = "application/wasm"
        };
        foreach (string file in types.Keys) if (!File.Exists(Path.Combine(root, file))) throw new FileNotFoundException("Falta un archivo del visor: " + file);
        using var server = new HttpListener();
        server.Prefixes.Add("http://127.0.0.1:8081/");
        try { server.Start(); } catch (HttpListenerException) { throw new IOException("No se pudo abrir el puerto 8081. Cierra otro visor local que lo esté usando y vuelve a intentarlo."); }
        Console.WriteLine("Visor preparado en http://127.0.0.1:8081/\nAbre esa dirección en tu navegador. Ctrl+C detiene el servidor.");
        while (server.IsListening) {
            var ctx = await server.GetContextAsync();
            _ = Respond(ctx, root, types);
        }
    }
    private static async Task Respond(HttpListenerContext ctx, string root, Dictionary<string, string> types) {
        try {
            var request = ctx.Request; var response = ctx.Response;
            if (request.HttpMethod != "GET" && request.HttpMethod != "HEAD") { response.StatusCode = 405; return; }
            string path = request.Url!.AbsolutePath;
            string name = path == "/" ? "index.html" : path.TrimStart('/');
            if (!types.TryGetValue(name, out string? mime)) { response.StatusCode = 404; return; }
            response.ContentType = mime; response.Headers["Cache-Control"] = "no-store";
            response.Headers["X-Content-Type-Options"] = "nosniff";
            response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
            using var stream = File.OpenRead(Path.Combine(root, name)); response.ContentLength64 = stream.Length;
            if (request.HttpMethod == "GET") await stream.CopyToAsync(response.OutputStream);
        } catch (IOException) { } catch (HttpListenerException) { }
        finally { ctx.Response.Close(); }
    }
}
