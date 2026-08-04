import type { LightTableDesktopBridge } from './desktopBridge';
import type { LightTableAutomationDriver } from '@lighttable/app';

declare global {
  interface Window {
    lightTableDesktop: LightTableDesktopBridge;
    __lightTableAutomation?: LightTableAutomationDriver;
  }
}

export {};
