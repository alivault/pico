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
 * Each machine has its own query cache. Query keys do not hold a machine ID,
 * so two machines must not share a cache. A machine keeps its cache when the
 * page opens another one, so a switch back shows its data at once.
 */
export function queryClientForMachine(machineId: string) {
  let client = machineQueryClients.get(machineId)
  if (!client) {
    client = createPicoQueryClient()
    machineQueryClients.set(machineId, client)
  }
  return client
}
