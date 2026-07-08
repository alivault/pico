# LucideSwift vendored package

This is a vendored app-local copy of [`ajaxjiang96/lucide-swift`](https://github.com/ajaxjiang96/lucide-swift) from commit `5fc7ab45485743feda981f92aa10236d21f5b0a8` (library version 0.7.6).

Pico uses a small local `Package.swift` that exposes only the runtime `LucideSwift` target. The upstream package manifest includes a local generator dependency, which Xcode cannot resolve when the package is consumed directly as a remote package dependency.
