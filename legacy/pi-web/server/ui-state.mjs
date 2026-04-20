export function createUiState() {
  return {
    statuses: {},
    title: undefined,
    editorText: "",
    workingMessage: undefined,
    hiddenThinkingLabel: undefined,
  }
}

export function createIdentityTheme() {
  const passthrough = (text) => text
  return {
    fg: (_color, text) => text,
    bg: (_color, text) => text,
    bold: passthrough,
    italic: passthrough,
    underline: passthrough,
    inverse: passthrough,
    strikethrough: passthrough,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => passthrough,
    getBashModeBorderColor: () => passthrough,
  }
}
