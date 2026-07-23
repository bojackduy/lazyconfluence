import { createProdTuiSource, type TuiDataSourceOptions } from "../data"
import type { TuiSource } from "../source"

export function createProdRuntimeSource(options: TuiDataSourceOptions = {}): TuiSource {
  return createProdTuiSource(undefined, options)
}
