import SwiftUI
import UIKit

struct UserMessageImagePreview: View {
  var images: [PromptImage]

  @Environment(\.dismiss) private var dismiss
  @GestureState private var dismissTranslation: CGSize = .zero
  @State private var selectedIndex: Int
  @State private var zoomedImageIndexes = Set<Int>()

  init(images: [PromptImage], initialIndex: Int) {
    self.images = images
    let upperBound = max(images.count - 1, 0)
    _selectedIndex = State(initialValue: min(max(initialIndex, 0), upperBound))
  }

  var body: some View {
    ZStack {
      Color.black
        .opacity(backgroundOpacity)
        .ignoresSafeArea()

      previewContent
        .offset(y: dismissOffset)
    }
    .preferredColorScheme(.dark)
    .statusBarHidden()
  }

  @ViewBuilder
  private var previewContent: some View {
    if images.isEmpty {
      ContentUnavailableView(
        "Image unavailable",
        picoSystemImage: "photo",
        description: Text("Pico could not load this image attachment.")
      )
      .foregroundStyle(.white)
    } else {
      TabView(selection: $selectedIndex) {
        ForEach(Array(images.enumerated()), id: \.offset) { index, image in
          ZoomableUserMessageImagePage(image: image) { isZoomed in
            setImageZoomed(isZoomed, at: index)
          }
          .tag(index)
          .accessibilityLabel(imageAccessibilityLabel(at: index))
        }
      }
      .tabViewStyle(
        .page(indexDisplayMode: images.count > 1 ? .automatic : .never)
      )
      .simultaneousGesture(dismissGesture)
      .animation(.default, value: dismissOffset)
      .accessibilityHint(accessibilityHint)
    }
  }

  private var dismissGesture: some Gesture {
    DragGesture(minimumDistance: 20)
      .updating($dismissTranslation) { value, state, _ in
        guard tracksDismissDrag(value) else { return }
        state = value.translation
      }
      .onEnded { value in
        guard tracksDismissDrag(value) else { return }
        let projectedHeight = max(
          value.translation.height,
          value.predictedEndTranslation.height
        )
        if projectedHeight > 160 {
          dismiss()
        }
      }
  }

  private var dismissOffset: CGFloat {
    max(dismissTranslation.height, 0)
  }

  private var backgroundOpacity: Double {
    let progress = min(max(dismissOffset / 260, 0), 1)
    return 1 - Double(progress) * 0.45
  }

  private var isCurrentImageZoomed: Bool {
    zoomedImageIndexes.contains(selectedIndex)
  }

  private var accessibilityHint: String {
    if images.count > 1 {
      return "Swipe horizontally to view other attachments. Swipe down to close. Double tap an image to zoom."
    }
    return "Swipe down to close. Double tap the image to zoom."
  }

  private func tracksDismissDrag(_ value: DragGesture.Value) -> Bool {
    guard !isCurrentImageZoomed else { return false }
    let translation = value.translation
    guard translation.height > 0 else { return false }
    return abs(translation.height) > abs(translation.width) * 1.25
  }

  private func setImageZoomed(_ isZoomed: Bool, at index: Int) {
    if isZoomed {
      zoomedImageIndexes.insert(index)
    } else {
      zoomedImageIndexes.remove(index)
    }
  }

  private func imageAccessibilityLabel(at index: Int) -> String {
    guard images.count > 1 else { return "Image attachment preview" }
    return "Image attachment preview \(index + 1) of \(images.count)"
  }
}

private struct ZoomableUserMessageImagePage: View {
  private static let maximumScale: CGFloat = 4
  private static let zoomedScaleThreshold: CGFloat = 1.01

  var image: PromptImage
  var onZoomStateChange: (Bool) -> Void

  @GestureState private var magnifyBy: CGFloat = 1
  @GestureState private var panTranslation: CGSize = .zero
  @State private var scale: CGFloat = 1
  @State private var offset: CGSize = .zero

  var body: some View {
    GeometryReader { proxy in
      if let uiImage = image.uiImage {
        zoomableImage(uiImage, containerSize: proxy.size)
      } else {
        ContentUnavailableView(
          "Image unavailable",
          picoSystemImage: "photo",
          description: Text("Pico could not load this image attachment.")
        )
        .foregroundStyle(.white)
        .frame(width: proxy.size.width, height: proxy.size.height)
      }
    }
    .clipped()
    .onAppear {
      onZoomStateChange(isZoomed)
    }
    .onChange(of: scale) { _, _ in
      onZoomStateChange(isZoomed)
    }
  }

  private var isZoomed: Bool {
    scale > Self.zoomedScaleThreshold
  }

  private func zoomableImage(_ uiImage: UIImage, containerSize: CGSize) -> some View {
    let imageSize = uiImage.size
    let fittedSize = Self.fittedSize(for: imageSize, in: containerSize)
    let currentScale = Self.clampedScale(scale * magnifyBy)
    let currentOffset = Self.clampedOffset(
      CGSize(
        width: offset.width + panTranslation.width,
        height: offset.height + panTranslation.height
      ),
      scale: currentScale,
      containerSize: containerSize,
      imageSize: imageSize
    )

    return ZStack {
      Image(uiImage: uiImage)
        .resizable()
        .scaledToFit()
        .frame(width: fittedSize.width, height: fittedSize.height)
        .scaleEffect(currentScale)
        .offset(currentOffset)
    }
    .frame(width: containerSize.width, height: containerSize.height)
    .contentShape(Rectangle())
    .gesture(magnifyGesture(containerSize: containerSize, imageSize: imageSize))
    .highPriorityGesture(
      panGesture(containerSize: containerSize, imageSize: imageSize),
      isEnabled: currentScale > Self.zoomedScaleThreshold
    )
    .simultaneousGesture(
      doubleTapGesture(containerSize: containerSize, imageSize: imageSize)
    )
    .accessibilityLabel("Image attachment preview")
    .accessibilityHint("Double tap to zoom. Drag to pan when zoomed.")
  }

  private func magnifyGesture(
    containerSize: CGSize,
    imageSize: CGSize
  ) -> some Gesture {
    MagnifyGesture()
      .updating($magnifyBy) { value, state, _ in
        state = value.magnification
      }
      .onEnded { value in
        let nextScale = Self.clampedScale(scale * value.magnification)
        scale = nextScale
        if nextScale <= Self.zoomedScaleThreshold {
          offset = .zero
        } else {
          offset = Self.clampedOffset(
            offset,
            scale: nextScale,
            containerSize: containerSize,
            imageSize: imageSize
          )
        }
      }
  }

  private func panGesture(
    containerSize: CGSize,
    imageSize: CGSize
  ) -> some Gesture {
    DragGesture(minimumDistance: 0)
      .updating($panTranslation) { value, state, _ in
        let proposedOffset = CGSize(
          width: offset.width + value.translation.width,
          height: offset.height + value.translation.height
        )
        let clampedOffset = Self.clampedOffset(
          proposedOffset,
          scale: scale,
          containerSize: containerSize,
          imageSize: imageSize
        )
        state = CGSize(
          width: clampedOffset.width - offset.width,
          height: clampedOffset.height - offset.height
        )
      }
      .onEnded { value in
        let proposedOffset = CGSize(
          width: offset.width + value.translation.width,
          height: offset.height + value.translation.height
        )
        offset = Self.clampedOffset(
          proposedOffset,
          scale: scale,
          containerSize: containerSize,
          imageSize: imageSize
        )
      }
  }

  private func doubleTapGesture(
    containerSize: CGSize,
    imageSize: CGSize
  ) -> some Gesture {
    SpatialTapGesture(count: 2)
      .onEnded { value in
        withAnimation(.default) {
          if scale > Self.zoomedScaleThreshold {
            scale = 1
            offset = .zero
          } else {
            let nextScale = min(Self.maximumScale, 2.5)
            scale = nextScale
            offset = Self.zoomOffset(
              for: value.location,
              scale: nextScale,
              containerSize: containerSize,
              imageSize: imageSize
            )
          }
        }
      }
  }

  private static func clampedScale(_ scale: CGFloat) -> CGFloat {
    min(max(scale, 1), maximumScale)
  }

  private static func fittedSize(
    for imageSize: CGSize,
    in containerSize: CGSize
  ) -> CGSize {
    guard imageSize.width > 0,
          imageSize.height > 0,
          containerSize.width > 0,
          containerSize.height > 0
    else { return containerSize }

    let scale = min(
      containerSize.width / imageSize.width,
      containerSize.height / imageSize.height
    )
    return CGSize(
      width: imageSize.width * scale,
      height: imageSize.height * scale
    )
  }

  private static func clampedOffset(
    _ offset: CGSize,
    scale: CGFloat,
    containerSize: CGSize,
    imageSize: CGSize
  ) -> CGSize {
    let fittedSize = fittedSize(for: imageSize, in: containerSize)
    let scaledSize = CGSize(
      width: fittedSize.width * scale,
      height: fittedSize.height * scale
    )
    let maximumX = max((scaledSize.width - containerSize.width) / 2, 0)
    let maximumY = max((scaledSize.height - containerSize.height) / 2, 0)

    return CGSize(
      width: min(max(offset.width, -maximumX), maximumX),
      height: min(max(offset.height, -maximumY), maximumY)
    )
  }

  private static func zoomOffset(
    for location: CGPoint,
    scale: CGFloat,
    containerSize: CGSize,
    imageSize: CGSize
  ) -> CGSize {
    let center = CGPoint(
      x: containerSize.width / 2,
      y: containerSize.height / 2
    )
    let proposedOffset = CGSize(
      width: -(location.x - center.x) * (scale - 1),
      height: -(location.y - center.y) * (scale - 1)
    )
    return clampedOffset(
      proposedOffset,
      scale: scale,
      containerSize: containerSize,
      imageSize: imageSize
    )
  }
}

extension PromptImage {
  var uiImage: UIImage? {
    guard let imageData = Data(base64Encoded: data) else { return nil }
    return UIImage(data: imageData)
  }
}
