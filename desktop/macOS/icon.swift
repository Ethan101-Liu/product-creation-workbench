import AppKit

let folder = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0)!
        let context = NSGraphicsContext(bitmapImageRep: bitmap)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.cgContext.scaleBy(x: CGFloat(pixels)/128, y: CGFloat(pixels)/128)
        NSColor(red: 0.16, green: 0.19, blue: 0.24, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 7, y: 7, width: 114, height: 114), xRadius: 24, yRadius: 24).fill()
        NSColor(white: 0.94, alpha: 1).setStroke()
        let frame = NSBezierPath(roundedRect: NSRect(x: 28, y: 36, width: 72, height: 56), xRadius: 6, yRadius: 6)
        frame.lineWidth = 4
        frame.stroke()
        let rail = NSBezierPath()
        rail.move(to: NSPoint(x: 48, y: 37))
        rail.line(to: NSPoint(x: 48, y: 91))
        rail.lineWidth = 3
        rail.stroke()
        NSColor(red: 0.72, green: 0.77, blue: 0.88, alpha: 1).setFill()
        let mark = NSBezierPath()
        for (i,p) in [NSPoint(x: 74,y: 78),NSPoint(x: 87,y: 64),NSPoint(x: 74,y: 50),NSPoint(x: 61,y: 64)].enumerated() {
            if i == 0 { mark.move(to: p) } else { mark.line(to: p) }
        }
        mark.close()
        mark.fill()
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        let file = folder.appendingPathComponent("icon_\(size)x\(size)\(suffix).png")
        try bitmap.representation(using: .png, properties: [:])!.write(to: file)
    }
}
