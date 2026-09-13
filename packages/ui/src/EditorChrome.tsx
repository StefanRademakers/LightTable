import type { HTMLAttributes, ReactNode } from 'react';

const classes = (base: string, className?: string) => className ? `${base} ${className}` : base;

export function EditorChrome({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('ui-editor-chrome', className)}
    data-ui-component="editor-chrome" data-suite-control="editor-chrome" />;
}

export function EditorChromeHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header {...props} className={classes('ui-editor-chrome__header', className)} />;
}

export function EditorMenuBarSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('ui-editor-menu-surface', className)} />;
}

export function EditorToolOptionsBar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={classes('ui-editor-tool-options', className)}
    data-ui-component="editor-tool-options" data-suite-control="editor-tool-options" />;
}

export function EditorChromeBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('ui-editor-chrome__body', className)} />;
}

export function EditorPanelSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('ui-editor-panel-surface', className)}
    data-ui-component="editor-panel-surface" data-suite-control="editor-panel-surface" />;
}

export interface EditorStatusBarProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function EditorStatusBar({ className, ...props }: EditorStatusBarProps) {
  return <footer {...props} className={classes('ui-editor-status-bar', className)}
    data-ui-component="editor-status-bar" data-suite-control="editor-status-bar" />;
}

export interface EditorStatusTextProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'normal' | 'error';
}

export function EditorStatusText({ className, tone = 'normal', ...props }: EditorStatusTextProps) {
  return <div {...props} className={classes('ui-editor-status-bar__text', className)} data-tone={tone} />;
}

export interface EditorStatusMetaProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function EditorStatusMeta({ className, interactive = false, ...props }: EditorStatusMetaProps) {
  return <div {...props} className={classes('ui-editor-status-bar__meta', className)} data-interactive={interactive || undefined} />;
}

export function EditorStatusSpacer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('ui-editor-status-bar__spacer', className)} aria-hidden="true" />;
}
