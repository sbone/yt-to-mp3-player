// Inspect or eject the same mounted USB medium through Disk Arbitration.
import DiskArbitration
import Foundation
import IOKit

func fail(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(1)
}

let args = Array(CommandLine.arguments.dropFirst())
guard ((args.count == 3 || args.count == 2) && args[0] == "inspect") || (args.count == 4 && args[0] == "eject") else {
    fail("Expected an operation, mount path, volume UUID and (for eject) attachment ID")
}
let url = URL(fileURLWithPath: args[1], isDirectory: true)
guard url.deletingLastPathComponent().path == "/Volumes", url.resolvingSymlinksInPath().path == url.path,
      let session = DASessionCreate(nil), let disk = DADiskCreateFromVolumePath(nil, session, url as CFURL),
      let info = DADiskCopyDescription(disk) as? [String: Any] else { fail("Player unavailable") }
let volume = try url.resourceValues(forKeys: [.volumeUUIDStringKey, .isVolumeKey, .volumeIsRemovableKey])
guard volume.isVolume == true, volume.volumeIsRemovable == true,
      let uuid = volume.volumeUUIDString.flatMap(UUID.init(uuidString:)),
      args.count == 2 || uuid.uuidString == args[2],
      (info[kDADiskDescriptionVolumePathKey as String] as? URL)?.path == url.path,
      info[kDADiskDescriptionDeviceInternalKey as String] as? Bool == false,
      info[kDADiskDescriptionMediaWholeKey as String] as? Bool == true,
      info[kDADiskDescriptionDeviceProtocolKey as String] as? String == "USB"
else { fail("Unknown player or unsupported disk layout") }
var fs = statfs()
guard statfs(args[1], &fs) == 0 else { fail("Player unavailable") }
let kind = withUnsafeBytes(of: &fs.f_fstypename) { String(decoding: $0.prefix(while: { $0 != 0 }), as: UTF8.self) }
guard ["msdos", "exfat"].contains(kind) else { fail("Unsupported player filesystem") }
let media = DADiskCopyIOMedia(disk)
var attachment: UInt64 = 0
guard media != IO_OBJECT_NULL, IORegistryEntryGetRegistryEntryID(media, &attachment) == KERN_SUCCESS else {
    fail("Could not identify player attachment")
}
IOObjectRelease(media)
if args[0] == "inspect" {
    if args.count == 2 {
        let record = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/mp3-deck/players/").appendingPathComponent(uuid.uuidString)
        guard FileManager.default.fileExists(atPath: record.path) else { fail("Player has not been enrolled") }
        print("Enrolled USB player confirmed. Read-only check passed.")
    } else { print(attachment) }
    exit(0)
}
guard args[3] == String(attachment) else { fail("Player was reconnected") }

// The callbacks operate on the DADisk we identified, including after the mount path disappears.
DASessionScheduleWithRunLoop(session, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
DADiskUnmount(disk, 0, { disk, dissent, _ in
    guard dissent == nil else { fail("Player is busy or could not unmount") }
    DADiskEject(disk, 0, { _, dissent, _ in
        guard dissent == nil else { fail("OS eject failed") }
        exit(0)
    }, nil)
}, nil)
RunLoop.current.run(until: Date(timeIntervalSinceNow: 45))
fail("OS eject timed out")
