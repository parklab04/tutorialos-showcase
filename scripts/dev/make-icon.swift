import AppKit
import ImageIO
import UniformTypeIdentifiers
let size = 1024
let cs = CGColorSpaceCreateDeviceRGB()
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(CGColor(red: 0.141, green: 0.408, blue: 0.365, alpha: 1))
ctx.addPath(CGPath(roundedRect: CGRect(x: 36, y: 36, width: 952, height: 952), cornerWidth: 220, cornerHeight: 220, transform: nil)); ctx.fillPath()
ctx.setStrokeColor(CGColor(red: 0.89, green: 0.96, blue: 0.91, alpha: 1)); ctx.setLineWidth(48); ctx.setLineCap(.round); ctx.setLineJoin(.round)
ctx.move(to: CGPoint(x: 287, y: 633)); ctx.addLine(to: CGPoint(x: 287, y: 737)); ctx.addLine(to: CGPoint(x: 392, y: 737))
ctx.move(to: CGPoint(x: 632, y: 737)); ctx.addLine(to: CGPoint(x: 737, y: 737)); ctx.addLine(to: CGPoint(x: 737, y: 633))
ctx.move(to: CGPoint(x: 287, y: 391)); ctx.addLine(to: CGPoint(x: 287, y: 287)); ctx.addLine(to: CGPoint(x: 392, y: 287)); ctx.strokePath()
ctx.setFillColor(CGColor(red: 1, green: 0.93, blue: 0.74, alpha: 1)); ctx.beginPath()
ctx.move(to: CGPoint(x: 464, y: 591)); ctx.addLine(to: CGPoint(x: 480, y: 281)); ctx.addLine(to: CGPoint(x: 556, y: 355)); ctx.addLine(to: CGPoint(x: 623, y: 217)); ctx.addLine(to: CGPoint(x: 689, y: 250)); ctx.addLine(to: CGPoint(x: 621, y: 382)); ctx.addLine(to: CGPoint(x: 727, y: 396)); ctx.closePath(); ctx.fillPath()
let image = ctx.makeImage()!
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(output, image, nil); CGImageDestinationFinalize(output)
