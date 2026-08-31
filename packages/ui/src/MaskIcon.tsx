/** Monochrome artwork tinted by its control; the host continues to own the asset. */
export function MaskIcon({ src, mode = 'alpha', className = '' }: { src: string; mode?: 'alpha' | 'luminance'; className?: string }) {
  return <span className={`ui-mask-icon${className ? ` ${className}` : ''}`} aria-hidden="true" style={{ maskImage: `url(${JSON.stringify(src)})`, maskMode: mode }} />;
}
