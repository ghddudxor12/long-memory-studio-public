// Usage: swift scripts/evict.swift <file-or-folder>...
// Makes Google Drive (File Provider) files online-only: removes the local copy, keeps the file in Drive.
// Run with the `swift` interpreter (a compiled binary written by Aside is killed by Gatekeeper/AV).
import Foundation
let fm = FileManager.default
var ok = 0, fail = 0, freed: Int64 = 0
func evict(_ url: URL) {
  let flags = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
  do { try fm.evictUbiquitousItem(at: url); ok += 1; freed += Int64(flags) } catch { fail += 1; FileHandle.standardError.write("ERR \(url.path): \(error.localizedDescription)\n".data(using: .utf8)!) }
}
for p in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: p); var isDir: ObjCBool = false
  guard fm.fileExists(atPath: p, isDirectory: &isDir) else { continue }
  if isDir.boolValue {
    let en = fm.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
    while let f = en?.nextObject() as? URL { if (try? f.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true { evict(f) } }
  } else { evict(url) }
}
print("evicted \(ok) files (\(freed / 1_000_000) MB), failed \(fail)")
