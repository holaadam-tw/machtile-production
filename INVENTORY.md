# APP machine-capability decision inventory

| Legacy APP decision | Current config/source | Capability field | Dual-read comparison |
|---|---|---|---|
| Single vs multi station | `multiStationMachines` | `station_mode` | `multi` when listed, otherwise `single` |
| Smart vs field report | `enableStationReport` + `stationReportMachines` (runtime guard remains separate) | `report_mode` | `smart` when globally enabled and listed, otherwise `field` |
| Finish close | `enableFinishClose` + `finishCloseMachines` | `close_enabled` | Boolean gate |
| Finish claim-next/start | `enableFinishClaimStartCombo` + `finishClaimStartComboMachines` | `claim_next_enabled` | Boolean gate |
| Replace stopped order | `dispatchPoolMachines` via `dispatchPoolCore.replaceStoppedState` | `replace_stopped_enabled` | Listed machine (role/order guards remain separate) |
| Dispatch-pool visibility/claim | `dispatchPoolMachines` | `dispatch_pool_enabled` | Listed machine |
| Station commands master gate | `stationCommandMachines` | `enabled` | Listed machine |

## Machine lists not represented by this capability contract

The following remain legacy-only and are inventoried to prevent accidental inference: `hmcPalletCardMachines`/`hmcPalletMap`, `inspectionLinkMachines`, `takeoverMachines`, `pickStartFlowMachines`, `standardFinishFlowMachines`, `shortCompletionMachines`, `switchStepStartedMachines`, `switchStepMoveMachines`, assembly station/defect lists, and G-code/HMC scheduling profiles. The cloud payload has no matching fields for these decisions. Global flags, runtime server guards, roles, order state, and tenant access also remain independent gates.

Dual-read is compare-only: every production decision continues returning the legacy result.
