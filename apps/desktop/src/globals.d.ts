import type { LightTableDesktopBridge } from './desktopBridge';

declare global {
  interface Window {
    lightTableDesktop: LightTableDesktopBridge;
  }
}

export {};
