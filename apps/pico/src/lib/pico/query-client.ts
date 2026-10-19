import { QueryClient } from "@tanstack/react-query"

export function createPicoQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  })
}

const machineQueryClients = new Map<string, QueryClient>()

/**
 * Each machine has its own query cache, given to its app shell by the route.
 * Query keys do not hold a machine ID: the cache of a machine holds only the
 * data of that machine, so the data of two machines cannot mix. Code that
 * needs the data of another machine reads it from that machine's cache.
 */
export function queryClientForMachine(machineId: string) {
  let client = machineQueryClients.get(machineId)
  if (!client) {
    client = createPicoQueryClient()
    machineQueryClients.set(machineId, client)
  }
  return client
}
