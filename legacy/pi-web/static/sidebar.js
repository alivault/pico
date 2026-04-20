export function isMobileViewport() {
  return window.matchMedia("(max-width: 980px)").matches
}

export function isSidebarVisible(state) {
  return isMobileViewport()
    ? state.sidebarDrawerOpenMobile
    : !state.sidebarCollapsedDesktop
}

export function openSidebarForViewport(state) {
  if (isMobileViewport()) {
    state.sidebarDrawerOpenMobile = true
    return
  }
  state.sidebarCollapsedDesktop = false
}

export function closeSidebarForViewport(state) {
  if (isMobileViewport()) {
    state.sidebarDrawerOpenMobile = false
    return
  }
  state.sidebarCollapsedDesktop = true
}

export function closeSidebarDrawerOnMobile(state) {
  state.sidebarDrawerOpenMobile = false
}

export function syncSidebarLayoutClasses(
  state,
  { body = document.body, appShell } = {}
) {
  body.classList.toggle("sidebar-collapsed", state.sidebarCollapsedDesktop)
  body.classList.toggle("sidebar-drawer-open", state.sidebarDrawerOpenMobile)
  appShell?.classList.toggle("sidebar-collapsed", state.sidebarCollapsedDesktop)
  appShell?.classList.toggle(
    "sidebar-drawer-open",
    state.sidebarDrawerOpenMobile
  )
}
