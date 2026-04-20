export function createTransport({
  state,
  withContext,
  renderMeta,
  handleEvent,
}) {
  let eventSource = null

  function connect() {
    eventSource?.close()
    state.replaying = false
    const source = new EventSource(withContext("/events"))
    eventSource = source

    source.onopen = () => {
      if (eventSource !== source) return
      state.connected = true
      renderMeta()
    }

    source.onerror = () => {
      if (eventSource !== source) return
      state.connected = false
      state.replaying = false
      renderMeta()
    }

    source.onmessage = (event) => {
      if (eventSource !== source) return
      const payload = JSON.parse(event.data)
      handleEvent(payload)
    }
  }

  async function get(path) {
    const response = await fetch(withContext(path))
    const text = await response.text()
    const data = text ? JSON.parse(text) : {}
    if (!response.ok) {
      throw new Error(data.error || `${response.status} ${response.statusText}`)
    }
    return data
  }

  async function post(path, body) {
    const response = await fetch(withContext(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    const text = await response.text()
    const data = text ? JSON.parse(text) : {}
    if (!response.ok) {
      throw new Error(data.error || `${response.status} ${response.statusText}`)
    }
    return data
  }

  return { connect, get, post }
}
