// Exports the Web Lock that decides which tab owns a share's session and mirror.
export { acquireTabLease, takeOverTabLease, tabLeaseName, type TabLease, type TabLeaseResult } from "./tabLease";
