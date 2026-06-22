import { BLUEHOUR_SCHEMA_VERSION } from "../google/googleSheetsAdapter";
import type { RemoteSheetSnapshot } from "../google/sheetSerialization";
import type { BluehourSnapshot } from "../../domain/types";
import {
  currentRemoteRevision,
  planRemoteSnapshotSync,
  SYNCED_STORES,
  type RemoteSyncPlan,
  type SyncedStoreName
} from "./remoteSync";

export { currentRemoteRevision, SYNCED_STORES, type RemoteSyncPlan as GoogleSyncPlan, type SyncedStoreName };

export function planGoogleSheetSync(local: BluehourSnapshot, remote: RemoteSheetSnapshot): RemoteSyncPlan {
  return planRemoteSnapshotSync(local, remote, {
    supportedSchemaVersion: BLUEHOUR_SCHEMA_VERSION,
    remoteLabel: "Google Sheet"
  });
}
