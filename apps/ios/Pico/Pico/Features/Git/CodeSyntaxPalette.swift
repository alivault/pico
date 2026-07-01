import SwiftUI
import UIKit

struct CodeSyntaxPalette {
  var colorScheme: ColorScheme

  var foreground: UIColor {
    color(light: 0x161B24, dark: 0xD7DEEC)
  }

  var comment: UIColor {
    color(light: 0x737B87, dark: 0x9199A5)
  }

  var keyword: UIColor {
    color(light: 0x6B4FD1, dark: 0xBC8FFF)
  }

  var string: UIColor {
    color(light: 0x008130, dark: 0x75D78D)
  }

  var number: UIColor {
    color(light: 0xD75928, dark: 0xFFA460)
  }

  var title: UIColor {
    color(light: 0x0055AE, dark: 0x7ABDFF)
  }

  var meta: UIColor {
    color(light: 0x007D9E, dark: 0x71C5DF)
  }

  var variable: UIColor {
    color(light: 0xCF3F50, dark: 0xFE9A9A)
  }

  var symbol: UIColor {
    color(light: 0xAC7900, dark: 0xDEC770)
  }

  var inserted: UIColor {
    color(light: 0x22C55E, dark: 0x16A34A)
  }

  var deleted: UIColor {
    color(light: 0xEF4444, dark: 0xDC2626)
  }

  var changed: UIColor {
    color(light: 0xF59E0B, dark: 0xF59E0B)
  }

  var primary: UIColor {
    color(light: 0x077AFD, dark: 0x077AFD)
  }

  func color(forCSSVariable cssVariable: String?) -> UIColor {
    guard let cssVariable else { return foreground }

    switch cssVariable {
    case "--sh-foreground", "--code-fg", "--foreground":
      return foreground
    case "--sh-token-comment", "--code-comment", "--sh-ansi-bright-black":
      return comment
    case "--sh-token-keyword", "--code-keyword", "--sh-ansi-magenta",
      "--sh-ansi-bright-magenta":
      return keyword
    case "--sh-token-string", "--sh-token-string-expression", "--code-string":
      return string
    case "--sh-token-constant", "--code-number":
      return number
    case "--sh-token-function", "--sh-token-link", "--code-title":
      return title
    case "--sh-token-punctuation", "--code-meta", "--sh-ansi-cyan",
      "--sh-ansi-bright-cyan":
      return meta
    case "--sh-token-parameter", "--code-variable":
      return variable
    case "--code-symbol":
      return symbol
    case "--sh-token-inserted", "--success", "--sh-ansi-green",
      "--sh-ansi-bright-green":
      return inserted
    case "--sh-token-deleted", "--danger", "--sh-ansi-red",
      "--sh-ansi-bright-red":
      return deleted
    case "--sh-token-changed", "--warning", "--sh-ansi-yellow",
      "--sh-ansi-bright-yellow":
      return changed
    case "--primary", "--sh-ansi-blue", "--sh-ansi-bright-blue":
      return primary
    case "--sh-ansi-black", "--background":
      return color(light: 0xFFFFFF, dark: 0x252525)
    case "--sh-ansi-white", "--sh-ansi-bright-white":
      return foreground
    default:
      return foreground
    }
  }

  private func color(light: UInt32, dark: UInt32) -> UIColor {
    UIColor(hexRGB: colorScheme == .dark ? dark : light)
  }
}

private extension UIColor {
  convenience init(hexRGB: UInt32) {
    self.init(
      red: CGFloat((hexRGB >> 16) & 0xFF) / 255,
      green: CGFloat((hexRGB >> 8) & 0xFF) / 255,
      blue: CGFloat(hexRGB & 0xFF) / 255,
      alpha: 1
    )
  }
}
