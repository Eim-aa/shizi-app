import Foundation
import ShiziImageRendering

// JSON input specs -> PNG files. Same renderer linked by the iOS app; no simulator required.
let args = CommandLine.arguments
if args.count != 4 {
  fputs("usage: shizi-image-cli ASSET_ROOT INPUT_JSON OUTPUT_DIR\n", stderr)
  exit(2)
}
do {
  let specs =
    try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[2])))
    as! [[String: Any]]
  let out = URL(fileURLWithPath: args[3])
  try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
  let renderer = ImageRenderer(assets: URL(fileURLWithPath: args[1]))
  for spec in specs {
    let id = spec["id"] as! String
    let pngs = try renderer.render(spec)
    for (i, data) in pngs.enumerated() {
      try data.write(to: out.appendingPathComponent("\(id)-\(i).png"))
    }
  }
  print("Rendered \(specs.count) inputs")
} catch {
  fputs("\(error)\n", stderr)
  exit(1)
}
