import './ui/theme.css';
import './ui/primitives.css';

export { LightTableStandaloneApp } from './standalone/LightTableStandaloneApp';
export {
  createLightTableImageClipboard,
  type LightTableImageClipboard
} from './platform/LightTableImageClipboard';
export {
  createLocalLightTableFunnelTelemetry,
  type LightTableFunnelEvent,
  type LightTableFunnelTelemetry
} from './platform/LightTableFunnelTelemetry';
export type { LightTableHost } from './platform/LightTableHost';
export type { LightTableAutomationDriver } from './lighttable/application/commands/lightTableCommandService';
export {
  configureVectorRendererBackend,
  configureVectorRenderIslands,
  configureVectorRendererDetailedProfiling,
  type VectorRendererBackendSelection
} from './lighttable/gpu/vectorRendererBackendDiagnostics';
